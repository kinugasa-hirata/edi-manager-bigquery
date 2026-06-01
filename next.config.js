// next.config.js — 修正後
/** @type {import('next').NextConfig} */
const nextConfig = {
  // output: 'export',  ← この行を削除またはコメントアウト
  allowedDevOrigins: ['192.168.2.35'],  // ← これも追加
}

module.exports = nextConfig