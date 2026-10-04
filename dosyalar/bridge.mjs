import net from 'node:net';
import https from 'node:https';
import dns from 'node:dns';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LISTEN_HOST = '127.0.0.1';
const LISTEN_PORT = 10808;
const CIADPI_HOST = '127.0.0.1';
const CIADPI_PORT = 10809;
const DOMAINS_FILE = path.join(__dirname, 'direct_domains.json');

// Default domains that ALWAYS connect directly (ISP DNS + native TCP)
const DEFAULT_DIRECT_DOMAINS = [
  'donanimhaber.com',
  'donanimarsivi.com',
  'trendyol.com',
  'hepsiburada.com',
  'sahibinden.com',
  'n11.com',
  'yemeksepeti.com',
  'getir.com',
  'ciceksepeti.com',
  'akakce.com',
  'cimri.com',
  'technopat.net',
  'shiftdelete.net',
  'webtekno.com',
  'r10.net',
  'bionluk.com',
  'kariyer.net',
  'google.com',
  'youtube.com',
  'googlevideo.com',
  'ytimg.com',
  'gstatic.com',
  'googleapis.com',
  'netflix.com',
  'nflxvideo.net',
  'steampowered.com',
  'steamcontent.com',
  'steamcommunity.com',
  'microsoft.com',
  'windowsupdate.com',
  'office.com',
  'live.com',
  'apple.com',
  'icloud.com',
  'instagram.com',
  'cdninstagram.com',
  'facebook.com',
  'fbcdn.net',
  'whatsapp.com',
  'whatsapp.net',
  'linkedin.com',
  'github.com',
  'githubusercontent.com',
  'chatgpt.com',
  'openai.com',
  'twitch.tv',
  'ttvnw.net',
  'spotify.com'
];

function loadDirectDomains() {
  try {
    if (fs.existsSync(DOMAINS_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(DOMAINS_FILE, 'utf8'));
      if (Array.isArray(parsed)) return parsed;
    }
  } catch {}
  return [...DEFAULT_DIRECT_DOMAINS];
}

function saveDirectDomains(list) {
  try {
    fs.writeFileSync(DOMAINS_FILE, JSON.stringify(list, null, 2), 'utf8');
  } catch {}
}

let directDomains = loadDirectDomains();

// On-demand lifecycle management for ciadpi.exe (controlled by the Opera Extension)
let dpiActive = false;
let ciaProc = null;

function startCiaDpi() {
  dpiActive = true;
  if (ciaProc && !ciaProc.killed && ciaProc.exitCode === null) {
    return;
  }
  const exePath = path.join(__dirname, 'ciadpi.exe');
  ciaProc = spawn(
    exePath,
    ['-i', CIADPI_HOST, '-p', String(CIADPI_PORT), '--split', '1', '--tlsrec', '1+s'],
    { windowsHide: true, stdio: 'ignore' }
  );
  ciaProc.on('exit', () => {
    ciaProc = null;
    if (dpiActive) {
      setTimeout(() => {
        if (dpiActive) startCiaDpi();
      }, 1000);
    }
  });
  ciaProc.on('error', () => {});
}

function stopCiaDpi() {
  dpiActive = false;
  if (ciaProc) {
    try {
      ciaProc.kill();
    } catch {}
    ciaProc = null;
  }
}

// Known DPI-blocked root domains (plus dynamically learned domains on ECONNRESET)
const dpiBlockedDomains = new Set([
  'pornhub.com',
  'phncdn.com',
  'redgifs.com',
  'xvideos.com',
  'xnxx.com',
  'xhamster.com',
  'xhcdn.com',
  'imgur.com',
  'chaturbate.com',
  'stripchat.com',
  'spankbang.com',
  'eporner.com',
  'youporn.com',
  'tube8.com',
  'redtube.com',
  'brazzers.com',
  'onlyfans.com',
  'wattpad.com',
  'roblox.com',
  'rbxcdn.com',
  'discord.com',
  'discordapp.com',
  'discord.gg'
]);

function isDirectHost(host) {
  const h = host.toLowerCase();
  if (!h.includes('.') || h === 'localhost' || h.endsWith('.local') || h.endsWith('.tr')) {
    return true;
  }
  if (/^(127\.|192\.168\.|10\.)/.test(h)) {
    return true;
  }
  for (const d of directDomains) {
    if (h === d || h.endsWith('.' + d)) return true;
  }
  return false;
}

function isKnownDpiBlocked(host) {
  const h = host.toLowerCase();
  for (const d of dpiBlockedDomains) {
    if (h === d || h.endsWith('.' + d)) return true;
  }
  return false;
}

function markDpiBlocked(host) {
  const parts = host.toLowerCase().split('.');
  if (parts.length >= 2) {
    dpiBlockedDomains.add(parts.slice(-2).join('.'));
  } else {
    dpiBlockedDomains.add(host.toLowerCase());
  }
}

// Keep-alive HTTPS agent directly to Cloudflare DoH IP (1.1.1.1)
const dohAgent = new https.Agent({
  keepAlive: true,
  maxSockets: 32,
  servername: 'cloudflare-dns.com'
});

const dnsCache = new Map(); // host -> { ip, exp }

function isIPv4(str) {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(str);
}

function resolveSystemIPv4(host) {
  if (isIPv4(host)) return Promise.resolve(host);
  return new Promise((resolve, reject) => {
    dns.lookup(host, { family: 4 }, (err, address) => {
      if (err || !address) reject(err || new Error('System DNS failed'));
      else resolve(address);
    });
  });
}

function resolveDoHIPv4(host) {
  if (isIPv4(host)) return Promise.resolve(host);
  const now = Date.now();
  const cached = dnsCache.get(host);
  if (cached && cached.exp > now) return Promise.resolve(cached.ip);

  return new Promise((resolve, reject) => {
    const req = https.get(
      {
        host: '1.1.1.1',
        port: 443,
        path: `/dns-query?name=${encodeURIComponent(host)}&type=A`,
        headers: {
          'Host': 'cloudflare-dns.com',
          'Accept': 'application/dns-json'
        },
        agent: dohAgent,
        timeout: 3500
      },
      (res) => {
        let body = '';
        res.on('data', (c) => { body += c; });
        res.on('end', () => {
          try {
            const json = JSON.parse(body);
            const ans = (json.Answer || []).find((a) => a.type === 1 && isIPv4(a.data));
            if (ans) {
              const ttl = Math.max(60, Math.min(ans.ttl || 300, 3600));
              dnsCache.set(host, { ip: ans.data, exp: Date.now() + ttl * 1000 });
              resolve(ans.data);
            } else {
              resolveSystemIPv4(host).then(resolve).catch(reject);
            }
          } catch (e) {
            resolveSystemIPv4(host).then(resolve).catch(() => reject(e));
          }
        });
      }
    );
    req.on('error', () => resolveSystemIPv4(host).then(resolve).catch(reject));
    req.on('timeout', () => {
      req.destroy();
      resolveSystemIPv4(host).then(resolve).catch(reject);
    });
  });
}

// Connect to ciadpi.exe via SOCKS4 using resolved IPv4 address
function connectViaCiaDpi(ip, port) {
  if (!dpiActive || !ciaProc) {
    startCiaDpi();
  }
  return new Promise((resolve, reject) => {
    const sock = net.connect({ host: CIADPI_HOST, port: CIADPI_PORT, noDelay: true }, () => {
      const ipParts = ip.split('.').map((x) => parseInt(x, 10));
      const reqBuf = Buffer.from([
        0x04, // SOCKS4
        0x01, // CONNECT
        (port >> 8) & 0xff,
        port & 0xff,
        ipParts[0],
        ipParts[1],
        ipParts[2],
        ipParts[3],
        0x00 // empty userid null-terminated
      ]);
      sock.write(reqBuf);
    });

    const onData = (buf) => {
      sock.removeListener('data', onData);
      if (buf.length >= 8 && buf[0] === 0x00 && buf[1] === 0x5a) {
        resolve({ sock, extra: buf.subarray(8) });
      } else {
        sock.destroy();
        reject(new Error('SOCKS4 connect rejected by ciadpi'));
      }
    };

    sock.on('data', onData);
    sock.on('error', reject);
    sock.setTimeout(8000, () => {
      sock.destroy(new Error('SOCKS4 connect timeout'));
    });
  });
}

function connectDirectTcp(ip, port) {
  return new Promise((resolve, reject) => {
    const sock = net.connect({ host: ip, port, noDelay: true }, () => {
      sock.setTimeout(0);
      resolve(sock);
    });
    sock.on('error', reject);
    sock.setTimeout(6000, () => {
      sock.destroy(new Error('Direct TCP timeout'));
    });
  });
}

function buildPacScript() {
  return `var DIRECT_DOMAINS = ${JSON.stringify(directDomains, null, 2)};

function FindProxyForURL(url, host) {
  host = host.toLowerCase();
  if (isPlainHostName(host) ||
      shExpMatch(host, "localhost") ||
      shExpMatch(host, "127.*") ||
      shExpMatch(host, "192.168.*") ||
      shExpMatch(host, "10.*") ||
      shExpMatch(host, "*.local") ||
      shExpMatch(host, "*.tr")) {
    return "DIRECT";
  }
  for (var i = 0; i < DIRECT_DOMAINS.length; i++) {
    var d = DIRECT_DOMAINS[i];
    if (host === d || dnsDomainIs(host, "." + d)) {
      return "DIRECT";
    }
  }
  return "PROXY 127.0.0.1:10808; DIRECT";
}
`;
}

function sendJson(clientSock, statusCode, obj) {
  const body = JSON.stringify(obj);
  const res = [
    `HTTP/1.1 ${statusCode} OK`,
    'Content-Type: application/json; charset=utf-8',
    'Access-Control-Allow-Origin: *',
    'Access-Control-Allow-Methods: GET, POST, OPTIONS',
    'Access-Control-Allow-Headers: Content-Type',
    `Content-Length: ${Buffer.byteLength(body)}`,
    'Connection: close',
    '',
    body
  ].join('\r\n');
  clientSock.end(res);
}

function pipeSockets(clientSock, remoteSock) {
  clientSock.pipe(remoteSock);
  remoteSock.pipe(clientSock);
  clientSock.on('error', () => remoteSock.destroy());
  remoteSock.on('error', () => clientSock.destroy());
}

const server = net.createServer({ noDelay: true }, (clientSock) => {
  clientSock.setNoDelay(true);
  clientSock.once('data', async (firstChunk) => {
    try {
      const headerStr = firstChunk.toString('utf8');
      const headerEnd = headerStr.indexOf('\r\n\r\n');
      const firstLine = headerStr.split('\r\n')[0] || '';

      // 0) Handle CORS preflight for Extension API
      if (firstLine.startsWith('OPTIONS /__dpi_control/')) {
        sendJson(clientSock, 200, { ok: true });
        return;
      }

      // 1) Local Control API for the Opera/Chrome Extension
      if (firstLine.includes(' /__dpi_control/')) {
        const [, method, pathPart] = firstLine.match(/^([A-Z]+)\s+(\/[^\s]*)/) || [];
        const bodyStr = headerEnd !== -1 ? headerStr.slice(headerEnd + 4) : '';

        if (pathPart === '/__dpi_control/status') {
          sendJson(clientSock, 200, {
            ok: true,
            running: dpiActive && !!(ciaProc && ciaProc.pid),
            ciaPid: ciaProc ? ciaProc.pid : null,
            directDomains,
            pacScript: buildPacScript()
          });
          return;
        }

        if (pathPart === '/__dpi_control/start' && method === 'POST') {
          startCiaDpi();
          // Wait briefly for ciadpi to spawn
          await new Promise((r) => setTimeout(r, 150));
          sendJson(clientSock, 200, {
            ok: true,
            running: true,
            ciaPid: ciaProc ? ciaProc.pid : null,
            directDomains,
            pacScript: buildPacScript()
          });
          return;
        }

        if (pathPart === '/__dpi_control/stop' && method === 'POST') {
          stopCiaDpi();
          sendJson(clientSock, 200, {
            ok: true,
            running: false,
            ciaPid: null
          });
          return;
        }

        if (pathPart === '/__dpi_control/domains' && method === 'POST') {
          try {
            const payload = JSON.parse(bodyStr || '{}');
            if (Array.isArray(payload.directDomains)) {
              directDomains = payload.directDomains
                .map((d) => String(d).trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, ''))
                .filter(Boolean);
              directDomains = [...new Set(directDomains)];
              saveDirectDomains(directDomains);
            }
            sendJson(clientSock, 200, {
              ok: true,
              directDomains,
              pacScript: buildPacScript()
            });
          } catch (e) {
            sendJson(clientSock, 400, { ok: false, error: e.message });
          }
          return;
        }
      }

      // 2) Serve PAC file if requested
      if (firstLine.startsWith('GET /proxy.pac') || firstLine.startsWith('HEAD /proxy.pac')) {
        const pac = buildPacScript();
        const resHeaders = [
          'HTTP/1.1 200 OK',
          'Content-Type: application/x-ns-proxy-autoconfig',
          `Content-Length: ${Buffer.byteLength(pac)}`,
          'Cache-Control: no-cache, no-store, must-revalidate',
          'Connection: close',
          '',
          ''
        ].join('\r\n');
        clientSock.end(firstLine.startsWith('HEAD') ? resHeaders : resHeaders + pac);
        return;
      }

      // 3) Standard HTTP CONNECT tunnel (from Opera Extension PAC)
      if (firstLine.startsWith('CONNECT ')) {
        const target = firstLine.split(' ')[1] || '';
        const lastColon = target.lastIndexOf(':');
        const host = lastColon !== -1 ? target.slice(0, lastColon) : target;
        const port = lastColon !== -1 ? parseInt(target.slice(lastColon + 1), 10) : 443;
        const rawHeaderEnd = firstChunk.indexOf(Buffer.from('\r\n\r\n'));
        const initialPayload = rawHeaderEnd !== -1 && firstChunk.length > rawHeaderEnd + 4
          ? firstChunk.subarray(rawHeaderEnd + 4)
          : null;

        if (isDirectHost(host)) {
          const ip = await resolveSystemIPv4(host).catch(() => resolveDoHIPv4(host));
          const directSock = await connectDirectTcp(ip, port);
          clientSock.write('HTTP/1.1 200 Connection Established\r\n\r\n');
          if (initialPayload && initialPayload.length > 0) {
            directSock.write(initialPayload);
          }
          pipeSockets(clientSock, directSock);
          return;
        }

        const ip = await resolveDoHIPv4(host);

        if (isKnownDpiBlocked(host)) {
          const { sock: ciaSock, extra } = await connectViaCiaDpi(ip, port);
          ciaSock.setTimeout(0);
          clientSock.write('HTTP/1.1 200 Connection Established\r\n\r\n');
          if (initialPayload && initialPayload.length > 0) {
            ciaSock.write(initialPayload);
          }
          if (extra && extra.length > 0) {
            clientSock.write(extra);
          }
          pipeSockets(clientSock, ciaSock);
          return;
        }

        clientSock.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        const waitClientHello = initialPayload && initialPayload.length > 0
          ? Promise.resolve(initialPayload)
          : new Promise((resolve, reject) => {
              clientSock.once('data', resolve);
              clientSock.once('error', reject);
              clientSock.once('close', () => reject(new Error('Client closed')));
            });

        const clientHello = await waitClientHello;
        try {
          const directSock = await connectDirectTcp(ip, port);
          const firstServerChunk = await new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('DPI_TIMEOUT')), 1800);
            directSock.once('data', (d) => {
              clearTimeout(timer);
              resolve(d);
            });
            directSock.once('error', (err) => {
              clearTimeout(timer);
              reject(err);
            });
            directSock.once('end', () => {
              clearTimeout(timer);
              reject(new Error('DPI_EOF'));
            });
            directSock.write(clientHello);
          });

          clientSock.write(firstServerChunk);
          pipeSockets(clientSock, directSock);
        } catch {
          markDpiBlocked(host);
          const { sock: ciaSock, extra } = await connectViaCiaDpi(ip, port);
          ciaSock.setTimeout(0);
          ciaSock.write(clientHello);
          if (extra && extra.length > 0) {
            clientSock.write(extra);
          }
          pipeSockets(clientSock, ciaSock);
        }
        return;
      }

      // 4) Plain HTTP request forwarding
      const matchHttp = firstLine.match(/^([A-Z]+)\s+http:\/\/([^\/:\s]+)(?::(\d+))?(\/[^\s]*)?\s+(HTTP\/1\.[01])$/i);
      if (matchHttp) {
        const [, method, host, portStr, pathPart, httpVer] = matchHttp;
        const port = portStr ? parseInt(portStr, 10) : 80;
        const ip = isDirectHost(host)
          ? await resolveSystemIPv4(host).catch(() => resolveDoHIPv4(host))
          : await resolveDoHIPv4(host);
        const remoteSock = isDirectHost(host)
          ? await connectDirectTcp(ip, port)
          : (await connectViaCiaDpi(ip, port)).sock;
        remoteSock.setTimeout(0);

        const restLines = headerStr.slice(firstLine.length);
        const rewrittenFirst = `${method} ${pathPart || '/'} ${httpVer}${restLines}`;
        remoteSock.write(Buffer.from(rewrittenFirst, 'latin1'));
        pipeSockets(clientSock, remoteSock);
        return;
      }

      clientSock.destroy();
    } catch {
      clientSock.destroy();
    }
  });
  clientSock.on('error', () => {});
});

server.on('error', () => process.exit(1));
server.listen(LISTEN_PORT, LISTEN_HOST, () => {
  console.log(`ByeDPI Extension Controller listening on http://${LISTEN_HOST}:${LISTEN_PORT}`);
});
