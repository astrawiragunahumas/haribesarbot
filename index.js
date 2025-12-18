import pkg from 'whatsapp-web.js';
const { Client, LocalAuth } = pkg;
import qrcode from 'qrcode-terminal';
import fetch from 'node-fetch';
import schedule from 'node-schedule';
import moment from 'moment-timezone';
import 'moment/locale/id.js';
import express from 'express';
import http from 'http';

moment.locale('id');

// === KONFIGURASI ===
const SHEET_ID = '16z5CZybXHdzfLEhwFCuL0wIYxoM98FsoG-TKMLXPzIU';
const SHEET_NAME = 'HariBesar';
const GROUP_ID = '120363405437459768@g.us';
const TZ = 'Asia/Jakarta';

// === WEB SERVER UNTUK KEEP-ALIVE (Replit/Render) ===
const app = express();
app.get('/', (req, res) => res.send('Bot WhatsApp is Alive! 🤖'));
app.get('/health', (req, res) => res.sendStatus(200));

const server = http.createServer(app);
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🌐 Server listening on port ${PORT}`))
  .on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`⚠️ Port ${PORT} busy. Web server skipped.`);
    } else {
      console.error('⚠️ Server error:', err);
    }
  });

// === INISIALISASI CLIENT WHATSAPP ===
const client = new Client({
  authStrategy: new LocalAuth({ dataPath: './.wwebjs_auth' }),
  puppeteer: {
    headless: true,
    args: [
      '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas', '--no-first-run', '--no-zygote',
      '--single-process', '--disable-gpu'
    ]
  }
});

client.on('qr', qr => {
  qrcode.generate(qr, { small: true });
  console.log('SCAN QR CODE DI BAWAH INI:');
});

client.on('ready', () => {
  console.log('✅ Bot WhatsApp berhasil terhubung!');
  // Jadwal kirim otomatis setiap jam 05:00 WIB
  schedule.scheduleJob('0 5 * * *', async () => {
    console.log('⏰ Executing scheduled check (05:00 WIB)...');
    await kirimPesanTerjadwal();
  });
});

// === HELPERS & LOGIC ===

async function ambilDataSheet() {
  try {
    const url = `https://opensheet.elk.sh/${SHEET_ID}/${SHEET_NAME}`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    const data = await response.json();

    return data.map(row => {
      if (!row.Tanggal || !row.Bulan) return null;
      return {
        rawTanggal: row.Tanggal,
        rawBulan: row.Bulan,
        keterangan: row["Hari Besar Nasional dan Internasional"]
      };
    }).filter(item => item !== null);
  } catch (error) {
    console.error('❌ Gagal mengambil data sheet:', error);
    return [];
  }
}

/**
 * Mengubah data mentah menjadi object dengan tanggal absolut (Moment object).
 * Menghitung occurrence terdekat (tahun ini atau tahun depan).
 */
function processHolidays(data) {
  const now = moment().tz(TZ).startOf('day');

  return data.map(item => {
    // Parse tanggal "1 Januari", "17 Agustus" dsb.
    // Asumsi format di sheet sudah benar ejaan bulannya ("Januari", "Februari", dll)
    const dateString = `${item.rawTanggal} ${item.rawBulan}`;
    let date = moment.tz(dateString, 'D MMMM', TZ).startOf('day');

    // Validasi jika parsing gagal
    if (!date.isValid()) return null;

    // Atur tahun. Jika tanggal tahun ini sudah lewat, set ke tahun depan
    date.year(now.year());
    if (date.isBefore(now)) {
      date.add(1, 'year');
    }

    return {
      ...item,
      date: date,
      diff: date.diff(now, 'days') // Selisih hari (0 = hari ini)
    };
  }).filter(i => i !== null).sort((a, b) => a.date.valueOf() - b.date.valueOf()); // Urutkan terdekat
}

// === FUNGSI UTAMA ===

async function kirimPesanTerjadwal() {
  const rawData = await ambilDataSheet();
  const holidays = processHolidays(rawData);

  // Filter: Hari ini ATAU dalam 5 hari ke depan
  const upcoming = holidays.filter(h => h.diff >= 0 && h.diff <= 5);

  if (upcoming.length > 0) {
    let pesan = `📢 *PENGINGAT HARI BESAR* \n(5 Hari Ke Depan)\n\n`;

    upcoming.forEach(h => {
      const hari = h.diff === 0 ? "HARI INI" : (h.diff === 1 ? "Besok" : `${h.diff} hari lagi`);
      pesan += `🗓 *${h.date.format('D MMMM YYYY')}* (${hari})\n`;
      pesan += `🎉 ${h.keterangan}\n\n`;
    });

    try {
      await client.sendMessage(GROUP_ID, pesan.trim());
      console.log(`✅ Pesan terkirim: ${upcoming.length} hari besar dalam 5 hari kedepan.`);
    } catch (err) {
      console.error('❌ Gagal kirim pesan:', err);
    }
  } else {
    console.log('ℹ️ Tidak ada hari besar dalam 5 hari ke depan. Skip pesan.');
  }
}

client.on('message', async msg => {
  const body = msg.body.toLowerCase();

  // Match /cek atau /cek <angka>
  // Regex: ^\/cek(?:\s+(\d+))?$
  // contoh: /cek -> n=1 (default), /cek 5 -> n=5

  if (body.startsWith('/cek') || body.startsWith('!cek')) {
    const match = body.match(/[!/]cek\s*(\d+)?/);
    let n = 1; // Default
    if (match && match[1]) {
      n = parseInt(match[1]);
    }

    // Batasi maximal agar tidak spam (misal max 50)
    if (n > 50) n = 50;
    if (n < 1) n = 1;

    console.log(`📩 Perintah /cek diterima. Menampilkan ${n} hari besar.`);

    const rawData = await ambilDataSheet();
    const holidays = processHolidays(rawData);

    // Ambil N hari besar terdekat (sudah disort di processHolidays)
    const selected = holidays.slice(0, n);

    if (selected.length > 0) {
      let pesan = `📅 *${n} HARI BESAR MENDATANG*\n\n`;
      selected.forEach(h => {
        const hari = h.diff === 0 ? "🔵 *HARI INI*" : `${h.diff} hari lagi`;
        pesan += `🗓 *${h.date.format('D MMMM YYYY')}* | ${hari}\n`;
        pesan += `🎉 ${h.keterangan}\n\n`;
      });
      msg.reply(pesan.trim());
    } else {
      msg.reply('❌ Tidak ada data hari besar yang ditemukan.');
    }
  }
});

client.initialize();
