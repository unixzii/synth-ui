//! A CRT, modelled physically. The frame goes up as a texture of palette
//! indices and the palette as a 256×1 texture. All light is linear and per
//! channel; nothing is weighted by hand, so what glows is simply what's
//! bright. Each frame:
//!
//! ```text
//! 1. wear      the phosphor under what was on screen since the last frame
//!              wears, in proportion to how hard the beam drove it and for
//!              how long (burn-in). It never recovers.
//! 2. phosphor  each pixel's light: its colour, less what wear has taken,
//!              or what's left of the last frame's as it fades, whichever is
//!              brighter (phosphors light at once and fade slowly).
//! 3. halation  the glass scatters some of that light around it: a blur down
//!              a chain of half-size targets and back up, each level reaching
//!              twice as far, summed into a long-tailed spread.
//! 4. present   at device resolution (see present.wgsl), letterboxed in the
//!              background colour.
//! ```
//!
//! With effects off, the frame is drawn sharp-bilinear and nothing else runs.

use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

use bytemuck::{Pod, Zeroable};
use wgpu::util::DeviceExt;

use crate::fx::{MaskType, PostFx};
use crate::raster::Surface;

const MAX_LEVELS: usize = 6;

macro_rules! shader {
    ($($file:literal),+) => {
        concat!($(include_str!(concat!("shaders/", $file))),+)
    };
}

#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
struct WearUniform {
    rate: f32,
    _pad: [f32; 3],
}

#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
struct PhosphorUniform {
    decay: [f32; 4],
}

#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
struct LevelUniform {
    dst: [f32; 2],
    texel: [f32; 2],
}

#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
struct PlainUniform {
    out_size: [f32; 2],
    origin: [f32; 2],
}

#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
struct PresentUniform {
    out_size: [f32; 2],
    origin: [f32; 2],
    halo_texel: [f32; 2],
    sigma_dim: f32,
    sigma_bright: f32,
    mask_low: f32,
    mask_gain: f32,
    halation: f32,
    halo_scale: f32,
    ambient: f32,
    vignette: f32,
    mask: i32,
    _pad: i32,
}

/// A frame to show, and where.
pub struct Frame<'a> {
    pub surface: &'a Surface,
    /// 256 RGBA entries, and a number that changes whenever they do.
    pub palette: &'a [u8; 1024],
    pub palette_version: u64,
    /// The letterbox colour, a palette index.
    pub background: u8,
    /// The drawable, and the picture inside it, in device pixels.
    pub device: (u32, u32),
    pub out: (u32, u32),
    pub origin: (u32, u32),
    pub fx: &'a PostFx,
    /// Milliseconds: drives what changes with time, like phosphors fading and wearing.
    pub time: f64,
}

struct Target {
    view: wgpu::TextureView,
    w: u32,
    h: u32,
}

struct Level {
    target: Target,
    /// Down into this level, from the one above it (or the light).
    down: wgpu::Buffer,
    /// Up from this level into the one above it.
    up: wgpu::Buffer,
}

/// Everything at the frame's size: the phosphors' light and wear (each a
/// pair, ping-ponged), and the halation chain.
struct Targets {
    w: u32,
    h: u32,
    light: [Target; 2],
    wear: [Target; 2],
    levels: Vec<Level>,
}

struct Pipelines {
    wear: wgpu::RenderPipeline,
    phosphor: wgpu::RenderPipeline,
    down: wgpu::RenderPipeline,
    up: wgpu::RenderPipeline,
    plain: wgpu::RenderPipeline,
    present: wgpu::RenderPipeline,
}

pub struct Crt {
    device: wgpu::Device,
    queue: wgpu::Queue,
    surface: wgpu::Surface<'static>,
    config: wgpu::SurfaceConfiguration,
    /// Light and wear are stored half-float where the GPU can render and filter it; burn-in needs that.
    target_format: wgpu::TextureFormat,
    float_targets: bool,
    pipelines: Pipelines,
    sampler: wgpu::Sampler,
    wear_uniform: wgpu::Buffer,
    phosphor_uniform: wgpu::Buffer,
    plain_uniform: wgpu::Buffer,
    present_uniform: wgpu::Buffer,
    index: Option<(wgpu::Texture, wgpu::TextureView)>,
    palette: wgpu::Texture,
    palette_view: wgpu::TextureView,
    palette_version: Option<u64>,
    targets: Option<Targets>,
    /// Which of the light pair is this frame's.
    current: usize,
    /// When the last frame was presented; None after a suspend or with effects off.
    last: Option<f64>,
    lost: Arc<AtomicBool>,
}

impl Crt {
    /// A CRT on `surface`, which `adapter` must be able to present to.
    pub async fn new(adapter: &wgpu::Adapter, surface: wgpu::Surface<'static>) -> Result<Self, String> {
        let (device, queue) = adapter
            .request_device(&wgpu::DeviceDescriptor { label: Some("synth-ui"), required_limits: wgpu::Limits::downlevel_webgl2_defaults().using_resolution(adapter.limits()), ..Default::default() })
            .await
            .map_err(|e| format!("synth-ui: no GPU device: {e}"))?;

        let lost = Arc::new(AtomicBool::new(false));
        let flag = lost.clone();
        device.set_device_lost_callback(move |reason, message| {
            flag.store(true, Ordering::Relaxed);
            log::error!("synth-ui: the GPU device was lost ({reason:?}): {message}");
        });

        let caps = surface.get_capabilities(adapter);
        // Colours are encoded by hand (to_srgb), so the surface mustn't encode them again.
        let format = caps.formats.iter().copied().find(|f| !f.is_srgb()).or(caps.formats.first().copied()).ok_or("synth-ui: the surface can't be presented to")?;
        let config = wgpu::SurfaceConfiguration {
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT,
            format,
            color_space: Default::default(),
            width: 0,
            height: 0,
            present_mode: wgpu::PresentMode::Fifo,
            desired_maximum_frame_latency: 2,
            alpha_mode: if caps.alpha_modes.contains(&wgpu::CompositeAlphaMode::Opaque) { wgpu::CompositeAlphaMode::Opaque } else { wgpu::CompositeAlphaMode::Auto },
            view_formats: vec![],
        };

        let half = adapter.get_texture_format_features(wgpu::TextureFormat::Rgba16Float);
        let float_targets = half.allowed_usages.contains(wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::TEXTURE_BINDING)
            && half.flags.contains(wgpu::TextureFormatFeatureFlags::FILTERABLE | wgpu::TextureFormatFeatureFlags::BLENDABLE);
        let target_format = if float_targets { wgpu::TextureFormat::Rgba16Float } else { wgpu::TextureFormat::Rgba8Unorm };

        let pipelines = Pipelines::new(&device, target_format, format);
        let sampler =
            device.create_sampler(&wgpu::SamplerDescriptor { label: Some("synth-ui linear"), mag_filter: wgpu::FilterMode::Linear, min_filter: wgpu::FilterMode::Linear, ..Default::default() });
        let uniform =
            |label, size| device.create_buffer(&wgpu::BufferDescriptor { label: Some(label), size, usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST, mapped_at_creation: false });
        let wear_uniform = uniform("synth-ui wear", size_of::<WearUniform>() as u64);
        let phosphor_uniform = uniform("synth-ui phosphor", size_of::<PhosphorUniform>() as u64);
        let plain_uniform = uniform("synth-ui plain", size_of::<PlainUniform>() as u64);
        let present_uniform = uniform("synth-ui present", size_of::<PresentUniform>() as u64);
        let palette = device.create_texture(&wgpu::TextureDescriptor {
            label: Some("synth-ui palette"),
            size: wgpu::Extent3d { width: 256, height: 1, depth_or_array_layers: 1 },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: wgpu::TextureFormat::Rgba8Unorm,
            usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
            view_formats: &[],
        });
        let palette_view = palette.create_view(&Default::default());

        Ok(Self {
            device,
            queue,
            surface,
            config,
            target_format,
            float_targets,
            pipelines,
            sampler,
            wear_uniform,
            phosphor_uniform,
            plain_uniform,
            present_uniform,
            index: None,
            palette,
            palette_view,
            palette_version: None,
            targets: None,
            current: 0,
            last: None,
            lost,
        })
    }

    /// Whether burn-in can show on this GPU (it needs half-float targets).
    pub fn wears(&self) -> bool {
        self.float_targets
    }

    /// The screen is off until the next frame: nothing wears or fades meanwhile.
    pub fn suspend(&mut self) {
        self.last = None;
    }

    pub fn present(&mut self, f: Frame) {
        let (w, h) = (f.surface.width() as u32, f.surface.height() as u32);
        if self.lost.load(Ordering::Relaxed) || w == 0 || h == 0 || f.device.0 == 0 || f.device.1 == 0 || f.out.0 == 0 || f.out.1 == 0 {
            return;
        }
        if (self.config.width, self.config.height) != f.device {
            self.config.width = f.device.0;
            self.config.height = f.device.1;
            self.surface.configure(&self.device, &self.config);
        }
        let resized = self.targets.as_ref().is_none_or(|t| (t.w, t.h) != (w, h));
        if resized {
            self.targets = Some(self.make_targets(w, h));
            self.current = 0;
        }
        let fx = f.fx;
        let dt = match self.last {
            Some(last) if !resized => (f.time - last).max(0.0),
            _ => 0.0,
        };
        self.last = fx.enabled.then_some(f.time);

        // Wear from what's been on screen since the last frame, before it's replaced: submitted
        // now, since writing the new frame's indices lands before anything in the next submit.
        if fx.enabled && fx.burn_in > 0.0 && self.float_targets && dt > 0.0 && self.index.is_some() {
            self.wear((fx.burn_in * dt / 3_600_000.0) as f32);
        }

        self.upload(f.surface, f.palette, f.palette_version);

        let frame = match self.surface.get_current_texture() {
            wgpu::CurrentSurfaceTexture::Success(t) | wgpu::CurrentSurfaceTexture::Suboptimal(t) => t,
            wgpu::CurrentSurfaceTexture::Outdated | wgpu::CurrentSurfaceTexture::Lost => {
                self.surface.configure(&self.device, &self.config);
                return;
            }
            _ => return,
        };
        let view = frame.texture.create_view(&Default::default());
        let mut encoder = self.device.create_command_encoder(&Default::default());
        let bg = &f.palette[f.background as usize * 4..][..4];
        let clear = wgpu::Color { r: bg[0] as f64 / 255.0, g: bg[1] as f64 / 255.0, b: bg[2] as f64 / 255.0, a: 1.0 };
        let viewport = [f.origin.0 as f32, f.origin.1 as f32, f.out.0 as f32, f.out.1 as f32];

        if fx.enabled {
            self.phosphor(&mut encoder, fx, dt);
            let halation = fx.halation.amount > 0.0 && !self.targets.as_ref().unwrap().levels.is_empty();
            let count = if halation { self.halation(&mut encoder, fx.halation.spread.round().clamp(1.0, MAX_LEVELS as f64) as usize) } else { 0 };
            self.present_pass(&mut encoder, &view, clear, viewport, fx, count, f.out);
        } else {
            let index = &self.index.as_ref().unwrap().1;
            self.queue.write_buffer(&self.plain_uniform, 0, bytemuck::bytes_of(&PlainUniform { out_size: [viewport[2], viewport[3]], origin: [viewport[0], viewport[1]] }));
            let bind = self.bind(&self.pipelines.plain, &[res(index), res(&self.palette_view), self.plain_uniform.as_entire_binding()]);
            draw(&mut encoder, &view, Some(clear), Some(viewport), &self.pipelines.plain, &bind);
        }
        self.queue.submit([encoder.finish()]);
        self.queue.present(frame);
    }

    fn upload(&mut self, surface: &Surface, palette: &[u8; 1024], version: u64) {
        let (w, h) = (surface.width() as u32, surface.height() as u32);
        let size = wgpu::Extent3d { width: w, height: h, depth_or_array_layers: 1 };
        if self.index.as_ref().is_none_or(|(t, _)| t.width() != w || t.height() != h) {
            let tex = self.device.create_texture(&wgpu::TextureDescriptor {
                label: Some("synth-ui indices"),
                size,
                mip_level_count: 1,
                sample_count: 1,
                dimension: wgpu::TextureDimension::D2,
                format: wgpu::TextureFormat::R8Unorm,
                usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
                view_formats: &[],
            });
            let view = tex.create_view(&Default::default());
            self.index = Some((tex, view));
        }
        let (tex, _) = self.index.as_ref().unwrap();
        self.queue.write_texture(tex.as_image_copy(), surface.data(), wgpu::TexelCopyBufferLayout { offset: 0, bytes_per_row: Some(w), rows_per_image: Some(h) }, size);
        if self.palette_version != Some(version) {
            self.queue.write_texture(
                self.palette.as_image_copy(),
                palette,
                wgpu::TexelCopyBufferLayout { offset: 0, bytes_per_row: Some(1024), rows_per_image: Some(1) },
                wgpu::Extent3d { width: 256, height: 1, depth_or_array_layers: 1 },
            );
            self.palette_version = Some(version);
        }
    }

    /// Wear under the frame still on the GPU (the last one), `rate` × its light.
    fn wear(&mut self, rate: f32) {
        self.queue.write_buffer(&self.wear_uniform, 0, bytemuck::bytes_of(&WearUniform { rate, _pad: [0.0; 3] }));
        let t = self.targets.as_mut().unwrap();
        let index = &self.index.as_ref().unwrap().1;
        let bind = bind(&self.device, &self.pipelines.wear, &[res(index), res(&self.palette_view), res(&t.wear[0].view), self.wear_uniform.as_entire_binding()]);
        let mut encoder = self.device.create_command_encoder(&Default::default());
        draw(&mut encoder, &t.wear[1].view, None, None, &self.pipelines.wear, &bind);
        self.queue.submit([encoder.finish()]);
        t.wear.swap(0, 1);
    }

    /// The phosphors' light this frame, into the other half of the pair.
    fn phosphor(&mut self, encoder: &mut wgpu::CommandEncoder, fx: &PostFx, dt: f64) {
        let decay = fx.persistence.map(|tau| if tau > 0.0 && dt > 0.0 { (-dt / tau).exp() as f32 } else { 0.0 });
        self.queue.write_buffer(&self.phosphor_uniform, 0, bytemuck::bytes_of(&PhosphorUniform { decay: [decay[0], decay[1], decay[2], 0.0] }));
        let prev = self.current;
        self.current ^= 1;
        let t = self.targets.as_ref().unwrap();
        let index = &self.index.as_ref().unwrap().1;
        let bind = self.bind(&self.pipelines.phosphor, &[res(index), res(&self.palette_view), res(&t.wear[0].view), res(&t.light[prev].view), self.phosphor_uniform.as_entire_binding()]);
        draw(encoder, &t.light[self.current].view, None, None, &self.pipelines.phosphor, &bind);
    }

    /// Down the chain from the light and back up, adding each blurrier level onto the sharper one. Returns how many levels were summed.
    fn halation(&self, encoder: &mut wgpu::CommandEncoder, count: usize) -> usize {
        let t = self.targets.as_ref().unwrap();
        let levels = &t.levels[..count.min(t.levels.len())];
        for (i, level) in levels.iter().enumerate() {
            let from = if i == 0 { &t.light[self.current].view } else { &levels[i - 1].target.view };
            let bind = self.bind(&self.pipelines.down, &[res(from), wgpu::BindingResource::Sampler(&self.sampler), level.down.as_entire_binding()]);
            draw(encoder, &level.target.view, None, None, &self.pipelines.down, &bind);
        }
        for i in (1..levels.len()).rev() {
            let bind = self.bind(&self.pipelines.up, &[res(&levels[i].target.view), wgpu::BindingResource::Sampler(&self.sampler), levels[i].up.as_entire_binding()]);
            draw(encoder, &levels[i - 1].target.view, None, None, &self.pipelines.up, &bind);
        }
        levels.len()
    }

    #[allow(clippy::too_many_arguments)]
    fn present_pass(&self, encoder: &mut wgpu::CommandEncoder, view: &wgpu::TextureView, clear: wgpu::Color, viewport: [f32; 4], fx: &PostFx, levels: usize, out: (u32, u32)) {
        let t = self.targets.as_ref().unwrap();
        let light = &t.light[self.current];
        let halo = if levels > 0 { &t.levels[0].target } else { light };
        let clamp01 = |x: f64| x.clamp(0.0, 1.0);

        // Beam widths, as a standard deviation in rows: 0.6 is flat.
        let dim = 0.6 - 0.48 * clamp01(fx.beam.scanlines);
        let bright = dim + (0.6 - dim) * clamp01(fx.beam.bloom);
        // The mask takes light away between its phosphors; the tube is driven harder to make up for it.
        let strength = clamp01(fx.mask.strength);
        let low = 1.0 - strength;
        let kind = if strength > 0.0 {
            match fx.mask.kind {
                MaskType::Aperture => 1,
                MaskType::Slot => 2,
                MaskType::Shadow => 3,
            }
        } else {
            0
        };
        let stripe = (1.0 + 2.0 * low) / 3.0;
        let mean = if kind == 2 { stripe * 0.75 + low * 0.25 } else { stripe };
        let u = PresentUniform {
            out_size: [out.0 as f32, out.1 as f32],
            origin: [viewport[0], viewport[1]],
            halo_texel: [1.0 / halo.w as f32, 1.0 / halo.h as f32],
            sigma_dim: dim as f32,
            sigma_bright: bright as f32,
            mask_low: low as f32,
            mask_gain: if kind != 0 { (1.0 / mean) as f32 } else { 1.0 },
            // The halo is the sum of every level, each carrying the whole light: average them.
            halation: if levels > 0 { clamp01(fx.halation.amount) as f32 } else { 0.0 },
            halo_scale: if levels > 0 { 1.0 / levels as f32 } else { 1.0 },
            ambient: fx.ambient.max(0.0) as f32,
            vignette: clamp01(fx.vignette) as f32,
            mask: kind,
            _pad: 0,
        };
        self.queue.write_buffer(&self.present_uniform, 0, bytemuck::bytes_of(&u));
        let bind =
            self.bind(&self.pipelines.present, &[res(&light.view), res(&t.wear[0].view), res(&halo.view), wgpu::BindingResource::Sampler(&self.sampler), self.present_uniform.as_entire_binding()]);
        draw(encoder, view, Some(clear), Some(viewport), &self.pipelines.present, &bind);
    }

    /// The light and wear pairs at the frame's size, and half-size halation levels down to a few pixels. Wear starts fresh.
    fn make_targets(&self, w: u32, h: u32) -> Targets {
        let target = |w, h| self.target(w, h);
        let mut levels = Vec::new();
        let (mut lw, mut lh) = (w.div_ceil(2), h.div_ceil(2));
        let (mut fw, mut fh) = (w, h);
        while levels.len() < MAX_LEVELS && lw >= 2 && lh >= 2 {
            let down = LevelUniform { dst: [lw as f32, lh as f32], texel: [1.0 / fw as f32, 1.0 / fh as f32] };
            let up = LevelUniform { dst: [fw as f32, fh as f32], texel: [0.5 / lw as f32, 0.5 / lh as f32] };
            let buffer =
                |label, u: &LevelUniform| self.device.create_buffer_init(&wgpu::util::BufferInitDescriptor { label: Some(label), contents: bytemuck::bytes_of(u), usage: wgpu::BufferUsages::UNIFORM });
            levels.push(Level { target: target(lw, lh), down: buffer("synth-ui level down", &down), up: buffer("synth-ui level up", &up) });
            (fw, fh) = (lw, lh);
            (lw, lh) = (lw.div_ceil(2), lh.div_ceil(2));
        }
        Targets { w, h, light: [target(w, h), target(w, h)], wear: [target(w, h), target(w, h)], levels }
    }

    /// A render target, black to start with.
    fn target(&self, w: u32, h: u32) -> Target {
        let tex = self.device.create_texture(&wgpu::TextureDescriptor {
            label: Some("synth-ui target"),
            size: wgpu::Extent3d { width: w, height: h, depth_or_array_layers: 1 },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: self.target_format,
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::TEXTURE_BINDING,
            view_formats: &[],
        });
        Target { view: tex.create_view(&Default::default()), w, h }
    }

    fn bind(&self, pipeline: &wgpu::RenderPipeline, resources: &[wgpu::BindingResource]) -> wgpu::BindGroup {
        bind(&self.device, pipeline, resources)
    }
}

fn res(view: &wgpu::TextureView) -> wgpu::BindingResource<'_> {
    wgpu::BindingResource::TextureView(view)
}

/// A bind group for `pipeline`'s group 0, binding `resources` in order.
fn bind(device: &wgpu::Device, pipeline: &wgpu::RenderPipeline, resources: &[wgpu::BindingResource]) -> wgpu::BindGroup {
    let entries: Vec<wgpu::BindGroupEntry> = resources.iter().enumerate().map(|(i, r)| wgpu::BindGroupEntry { binding: i as u32, resource: r.clone() }).collect();
    device.create_bind_group(&wgpu::BindGroupDescriptor { label: None, layout: &pipeline.get_bind_group_layout(0), entries: &entries })
}

/// One full-target triangle through `pipeline` into `view`, within `viewport` (x, y, w, h): cleared
/// first if `clear` is given, else onto what's there (which only additive pipelines care about).
fn draw(encoder: &mut wgpu::CommandEncoder, view: &wgpu::TextureView, clear: Option<wgpu::Color>, viewport: Option<[f32; 4]>, pipeline: &wgpu::RenderPipeline, bind: &wgpu::BindGroup) {
    let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
        label: None,
        color_attachments: &[Some(wgpu::RenderPassColorAttachment {
            view,
            depth_slice: None,
            resolve_target: None,
            ops: wgpu::Operations { load: clear.map_or(wgpu::LoadOp::Load, wgpu::LoadOp::Clear), store: wgpu::StoreOp::Store },
        })],
        depth_stencil_attachment: None,
        timestamp_writes: None,
        occlusion_query_set: None,
        multiview_mask: None,
    });
    if let Some([x, y, w, h]) = viewport {
        pass.set_viewport(x, y, w, h, 0.0, 1.0);
    }
    pass.set_pipeline(pipeline);
    pass.set_bind_group(0, bind, &[]);
    pass.draw(0..3, 0..1);
}

impl Pipelines {
    fn new(device: &wgpu::Device, target: wgpu::TextureFormat, output: wgpu::TextureFormat) -> Self {
        let module = |label, source: &'static str| device.create_shader_module(wgpu::ShaderModuleDescriptor { label: Some(label), source: wgpu::ShaderSource::Wgsl(source.into()) });
        let wear = module("synth-ui wear", shader!("common.wgsl", "lookup.wgsl", "wear.wgsl"));
        let phosphor = module("synth-ui phosphor", shader!("common.wgsl", "lookup.wgsl", "phosphor.wgsl"));
        let level = module("synth-ui level", shader!("common.wgsl", "level.wgsl"));
        let plain = module("synth-ui plain", shader!("common.wgsl", "lookup.wgsl", "plain.wgsl"));
        let present = module("synth-ui present", shader!("common.wgsl", "present.wgsl"));
        let additive = wgpu::BlendState {
            color: wgpu::BlendComponent { src_factor: wgpu::BlendFactor::One, dst_factor: wgpu::BlendFactor::One, operation: wgpu::BlendOperation::Add },
            alpha: wgpu::BlendComponent { src_factor: wgpu::BlendFactor::One, dst_factor: wgpu::BlendFactor::One, operation: wgpu::BlendOperation::Add },
        };
        let pipeline = |label, module: &wgpu::ShaderModule, entry, format, blend| {
            device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
                label: Some(label),
                layout: None,
                vertex: wgpu::VertexState { module, entry_point: Some("vs"), compilation_options: Default::default(), buffers: &[] },
                primitive: Default::default(),
                depth_stencil: None,
                multisample: Default::default(),
                fragment: Some(wgpu::FragmentState {
                    module,
                    entry_point: Some(entry),
                    compilation_options: Default::default(),
                    targets: &[Some(wgpu::ColorTargetState { format, blend, write_mask: wgpu::ColorWrites::ALL })],
                }),
                multiview_mask: None,
                cache: None,
            })
        };
        Self {
            wear: pipeline("synth-ui wear", &wear, "fs", target, None),
            phosphor: pipeline("synth-ui phosphor", &phosphor, "fs", target, None),
            down: pipeline("synth-ui down", &level, "down", target, None),
            up: pipeline("synth-ui up", &level, "up", target, Some(additive)),
            plain: pipeline("synth-ui plain", &plain, "fs", output, None),
            present: pipeline("synth-ui present", &present, "fs", output, None),
        }
    }
}

#[cfg(test)]
mod tests {
    /// Every pass's shader, and the fragment entry points in it.
    const SHADERS: [(&str, &str, &[&str]); 5] = [
        ("wear", shader!("common.wgsl", "lookup.wgsl", "wear.wgsl"), &["fs"]),
        ("phosphor", shader!("common.wgsl", "lookup.wgsl", "phosphor.wgsl"), &["fs"]),
        ("level", shader!("common.wgsl", "level.wgsl"), &["down", "up"]),
        ("plain", shader!("common.wgsl", "lookup.wgsl", "plain.wgsl"), &["fs"]),
        ("present", shader!("common.wgsl", "present.wgsl"), &["fs"]),
    ];

    #[test]
    fn shaders_are_valid_and_translate_to_webgl2() {
        use naga::back::glsl;
        for (name, source, entries) in SHADERS {
            let module = naga::front::wgsl::parse_str(source).unwrap_or_else(|e| panic!("{name}: {}", e.emit_to_string(source)));
            let info = naga::valid::Validator::new(naga::valid::ValidationFlags::all(), naga::valid::Capabilities::empty())
                .validate(&module)
                .unwrap_or_else(|e| panic!("{name}: {}", e.emit_to_string(source)));
            for (stage, entry) in entries.iter().map(|e| (naga::ShaderStage::Fragment, *e)).chain([(naga::ShaderStage::Vertex, "vs")]) {
                let options = glsl::Options { version: glsl::Version::new_gles(300), ..Default::default() };
                let pipeline = glsl::PipelineOptions { shader_stage: stage, entry_point: entry.into(), multiview: None };
                let mut out = String::new();
                glsl::Writer::new(&mut out, &module, &info, &options, &pipeline, Default::default()).and_then(|mut w| w.write()).unwrap_or_else(|e| panic!("{name}/{entry}: {e:?}"));
            }
        }
    }
}
