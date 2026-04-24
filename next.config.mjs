/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
  /** Keep native/file-path-dependent packages unbundled so __dirname resolves correctly at runtime. */
  serverExternalPackages: ['ffmpeg-static', 'kokoro-js', '@huggingface/transformers', 'onnxruntime-node'],
}

export default nextConfig
