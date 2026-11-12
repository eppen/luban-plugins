// Luban 本地插件示例。ctx 只给 root / sessionId / mode / signal / log（故意不给 execTool）。
const { execFile } = require('child_process');
const os = require('os');

function freeBytes(dir) {
  return new Promise(function (resolve, reject) {
    execFile('df', ['-k', dir], { timeout: 5000 }, function (err, stdout) {
      if (err) return reject(err);
      const line = String(stdout).trim().split('\n').pop().split(/\s+/);
      const kb = Number(line[3]);
      resolve(Number.isFinite(kb) ? kb * 1024 : null);
    });
  });
}

module.exports = {
  tools: {
    now: {
      handler: async function () {
        return new Date().toString() + ' (' + Intl.DateTimeFormat().resolvedOptions().timeZone + ')';
      }
    },
    disk_free: {
      handler: async function (args, ctx) {
        const n = await freeBytes(ctx.root || os.homedir());
        if (n == null) return '解析 df 输出失败';
        return Math.round(n / (1024 * 1024 * 1024) * 10) / 10 + ' GB 可用';
      }
    }
  }
};
