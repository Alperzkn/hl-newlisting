// PM2 ecosystem config — usage: `pm2 start ecosystem.config.cjs`
// Note: filename ends in .cjs because package.json sets "type": "module".

module.exports = {
  apps: [
    {
      name: "hl-newlisting",
      script: "dist/index.js",
      cwd: __dirname,
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      watch: false,
      max_memory_restart: "200M",
      time: true,
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};
