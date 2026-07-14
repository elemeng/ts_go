/** @type {import('next').NextConfig} */
const nextConfig = {
  // Skip build-time type checking for Deno compatibility
  typescript: {
    ignoreBuildErrors: true,
  },
};

export default nextConfig;
