// Luban 本地插件示例。ctx 只给 root / sessionId / mode / signal / log（故意不给 execTool）。
const { execFile } = require('child_process');
const os = require('os');
const path = require('path');

const GB = 1024 * 1024 * 1024;

function gb(n) {
  return Math.round(n / GB * 10) / 10 + ' GB';
}

// 返回 [{ name, used, free, mount? }]，单位字节
function listDisks() {
  if (process.platform === 'win32') {
    // Windows: 列出所有本地盘符的已用/剩余字节（无介质的盘访问会抛错，跳过）
    const script = 'Get-PSDrive -PSProvider FileSystem | ForEach-Object { try { "$($_.Name)|$($_.Used)|$($_.Free)" } catch { } }';
    return new Promise(function (resolve, reject) {
      execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script],
        { timeout: 5000 }, function (err, stdout) {
          if (err) return reject(err);
          const rows = String(stdout).split('\n').map(function (l) { return l.trim(); }).filter(Boolean)
            .map(function (l) {
              const p = l.split('|');
              return { name: p[0], used: Number(p[1]), free: Number(p[2]) };
            })
            .filter(function (r) { return Number.isFinite(r.used) && Number.isFinite(r.free); });
          resolve(rows);
        });
    });
  }
  // POSIX: df -k 列出所有挂载点，只保留真实设备（/dev/ 开头或网络挂载）
  return new Promise(function (resolve, reject) {
    execFile('df', ['-k'], { timeout: 5000 }, function (err, stdout) {
      if (err) return reject(err);
      const rows = String(stdout).trim().split('\n').slice(1).map(function (l) {
        const p = l.split(/\s+/);
        return { name: p[0], used: Number(p[2]), free: Number(p[3]), mount: p.slice(4).join(' ') };
      }).filter(function (r) {
        return Number.isFinite(r.used) && Number.isFinite(r.free) &&
          (r.name.indexOf('/dev/') === 0 || r.name.indexOf(':') !== -1);
      });
      resolve(rows);
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
        const dir = ctx.root || os.homedir();
        const rows = await listDisks();
        if (!rows.length) return '解析磁盘信息失败';
        const wsDrive = process.platform === 'win32'
          ? path.parse(path.resolve(dir)).root.replace(/\\$/, '').charAt(0).toUpperCase()
          : null;
        return rows.map(function (r) {
          const label = process.platform === 'win32'
            ? r.name + ':'
            : (r.mount ? r.name + ' (' + r.mount + ')' : r.name);
          const mark = wsDrive && r.name === wsDrive ? '  ← 工作区所在盘' : '';
          return label + '：剩余 ' + gb(r.free) + '，已用 ' + gb(r.used) + mark;
        }).join('\n');
      }
    }
  }
};
