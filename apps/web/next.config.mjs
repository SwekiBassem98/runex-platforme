/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Les packages partagés sont publiés en source TypeScript : Next doit les compiler.
  transpilePackages: ['@logixpress/ui', '@logixpress/types', '@logixpress/config'],
};

export default nextConfig;
