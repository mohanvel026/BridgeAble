// server/src/services/pdfService.js
// Week 7 — PDF export for health reports, transcripts, medicine logs
// Uses pdfkit npm package

const PDFDocument = require('pdfkit');

// ── Health Report PDF ─────────────────────────────────────
exports.generateHealthReport = async (patientName, logs = [], medicines = []) => {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ margin: 50, size: 'A4' });
      const chunks = [];

      doc.on('data', chunk => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

    // ── Header ──────────────────────────────────────────
    doc.rect(0, 0, doc.page.width, 80).fill('#040d0c');
    doc.fill('#22d3ee').fontSize(24).font('Helvetica-Bold')
      .text('BridgeAble', 50, 25);
    doc.fill('#94a3b8').fontSize(10).font('Helvetica')
      .text('Health Report — Confidential', 50, 52);
    doc.fill('#f0fdfb').fontSize(12)
      .text(`Patient: ${patientName}`, 350, 30, { align: 'right' });
    doc.text(`Generated: ${new Date().toLocaleDateString('en-IN', { dateStyle: 'long' })}`, 350, 48, { align: 'right' });

    doc.moveDown(3);

    // ── Summary stats ────────────────────────────────────
    doc.fill('#0f172a').fontSize(14).font('Helvetica-Bold')
      .text('Summary (Last 30 Days)', 50, doc.y);
    doc.moveDown(0.5);

    const safeLogs = Array.isArray(logs) ? logs : [];
    const avgSleep = avg(safeLogs.map(l => l.sleepQuality));
    const avgPain = avg(safeLogs.map(l => l.painLevel));
    const dominantMood = dominant(safeLogs.map(l => l.mood));

    const stats = [
      ['Total Log Entries', safeLogs.length],
      ['Average Sleep Quality', `${avgSleep.toFixed(1)} / 5`],
      ['Average Pain Level', `${avgPain.toFixed(1)} / 10`],
      ['Most Common Mood', dominantMood || 'N/A'],
      ['Dates Covered', safeLogs.length > 0
        ? `${new Date(safeLogs[0].date).toLocaleDateString()} – ${new Date(safeLogs[safeLogs.length - 1].date).toLocaleDateString()}`
        : 'No data'],
    ];

    stats.forEach(([label, value]) => {
      doc.fill('#334155').fontSize(10).font('Helvetica').text(label, 50, doc.y);
      doc.fill('#0f172a').font('Helvetica-Bold').text(String(value), 250, doc.y - 14);
      doc.moveDown(0.4);
    });

    doc.moveDown(1);

    // ── Daily log table ──────────────────────────────────
    doc.fill('#0f172a').fontSize(14).font('Helvetica-Bold').text('Daily Health Log');
    doc.moveDown(0.5);

    // Table header
    const cols = { date: 50, sleep: 170, pain: 250, mood: 330, appetite: 420 };
    doc.fill('#1e293b').rect(50, doc.y, doc.page.width - 100, 20).fill();
    doc.fill('#22d3ee').fontSize(9).font('Helvetica-Bold');
    doc.text('DATE', cols.date, doc.y - 15);
    doc.text('SLEEP', cols.sleep, doc.y - 15);
    doc.text('PAIN', cols.pain, doc.y - 15);
    doc.text('MOOD', cols.mood, doc.y - 15);
    doc.text('APPETITE', cols.appetite, doc.y - 15);
    doc.moveDown(0.3);

    // Table rows
    safeLogs.slice(-30).forEach((log, i) => {
      const rowY = doc.y;
      if (i % 2 === 0) {
        doc.fill('#f8fafc').rect(50, rowY - 3, doc.page.width - 100, 18).fill();
      }
      doc.fill('#334155').fontSize(9).font('Helvetica');
      doc.text(new Date(log.date).toLocaleDateString(), cols.date, rowY);
      doc.text(log.sleepQuality ? `${log.sleepQuality}/5` : '—', cols.sleep, rowY);
      doc.text(log.painLevel ? `${log.painLevel}/10` : '—', cols.pain, rowY);
      doc.text(log.mood || '—', cols.mood, rowY);
      doc.text(log.appetite || '—', cols.appetite, rowY);
      doc.moveDown(0.35);

      // Page break if needed
      if (doc.y > doc.page.height - 80) doc.addPage();
    });

    doc.moveDown(1);

    // ── Medicine section ─────────────────────────────────
    if (medicines?.length) {
      doc.addPage();
      doc.fill('#0f172a').fontSize(14).font('Helvetica-Bold').text('Medicine Schedule & Compliance');
      doc.moveDown(0.5);

      medicines.forEach(med => {
        const confirmed = (med.confirmations || []).filter(c => c.confirmed).length;
        const total = (med.confirmations || []).length;
        const compliance = total ? Math.round((confirmed / total) * 100) : 0;

        doc.fill('#1e293b').rect(50, doc.y, doc.page.width - 100, 55).fill();
        doc.fill('#f0fdfb').fontSize(12).font('Helvetica-Bold')
          .text(`${med.name} — ${med.dosage}`, 60, doc.y - 48);
        doc.fill('#94a3b8').fontSize(9).font('Helvetica')
          .text(`Times: ${(med.times || []).join(', ')}`, 60, doc.y - 32);
        doc.fill(compliance >= 80 ? '#22d3ee' : '#fb7185').fontSize(10)
          .text(`Compliance: ${compliance}% (${confirmed}/${total} doses confirmed)`, 60, doc.y - 18);
        doc.moveDown(0.3);
      });
    }

    // ── ALS blink tracker ────────────────────────────────
    const earLogs = safeLogs.filter(l => l?.blinkEAR);
    if (earLogs.length > 0) {
      doc.addPage();
      doc.fill('#0f172a').fontSize(14).font('Helvetica-Bold')
        .text('ALS Blink Strength (EAR) Progression');
      doc.fill('#94a3b8').fontSize(9).font('Helvetica')
        .text('Lower EAR values over time may indicate disease progression. Share with neurologist.');
      doc.moveDown(0.8);

      earLogs.forEach(log => {
        const barWidth = Math.round((log.blinkEAR / 0.4) * 300);
        doc.fill('#334155').fontSize(9).font('Helvetica')
          .text(new Date(log.date).toLocaleDateString(), 50, doc.y);
        doc.fill('#1e293b').rect(150, doc.y - 11, 300, 10).fill();
        doc.fill('#a78bfa').rect(150, doc.y - 11, Math.min(barWidth, 300), 10).fill();
        doc.fill('#334155').text(log.blinkEAR.toFixed(3), 460, doc.y - 11);
        doc.moveDown(0.4);
      });
    }

    // ── Footer ───────────────────────────────────────────
    const pageCount = doc.bufferedPageRange().count;
    for (let i = 0; i < pageCount; i++) {
      doc.switchToPage(i);
      doc.fill('#94a3b8').fontSize(8)
        .text(`BridgeAble Health Report — ${patientName} — Page ${i + 1} of ${pageCount}`,
          50, doc.page.height - 40, { align: 'center' });
    }

    doc.end();
    } catch (error) {
      reject(error);
    }
  });
};

// ── Transcript PDF ────────────────────────────────────────
exports.generateTranscriptPDF = async (roomCode, participants = [], transcripts = []) => {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ margin: 50, size: 'A4' });
      const chunks = [];

      doc.on('data', c => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

    // Header
    doc.rect(0, 0, doc.page.width, 70).fill('#040d0c');
    doc.fill('#22d3ee').fontSize(20).font('Helvetica-Bold').text('BridgeAble', 50, 20);
    doc.fill('#94a3b8').fontSize(10).font('Helvetica').text('Call Transcript', 50, 44);
    doc.fill('#f0fdfb').fontSize(10)
      .text(`Room: ${roomCode}`, 350, 25, { align: 'right' })
      .text(`Participants: ${participants.map(p => p.name).join(', ')}`, 350, 40, { align: 'right' });

    doc.moveDown(3);

    const modeLabel = { gesture: 'Sign', blink: 'Blink', symbol: 'Symbol', voice: 'Voice', type: 'Type' };

    transcripts.forEach((t, i) => {
      const sender = participants.find(p => p._id?.toString() === t.senderId?.toString());
      const name = sender?.name || 'Unknown';
      const time = new Date(t.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const mode = modeLabel[t.inputMode] || t.inputMode;

      doc.fill('#1e3a5f').fontSize(9).font('Helvetica-Bold')
        .text(`${name}  `, 50, doc.y, { continued: true });
      doc.fill('#64748b').font('Helvetica')
        .text(`[${mode}]  ${time}`);
      doc.fill('#0f172a').fontSize(10).font('Helvetica')
        .text(t.text, 60, doc.y, { width: doc.page.width - 120 });
      doc.moveDown(0.6);

      if (doc.y > doc.page.height - 80) doc.addPage();
    });

    doc.end();
    } catch (error) {
      reject(error);
    }
  });
};

// ── Medicine Log PDF ──────────────────────────────────────
exports.generateMedicinePDF = async (patientName, medicines = []) => {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ margin: 50 });
      const chunks = [];
      doc.on('data', c => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

    doc.fontSize(18).font('Helvetica-Bold').text(`Medicine Log — ${patientName}`);
    doc.fontSize(10).font('Helvetica').fill('#64748b')
      .text(`Generated: ${new Date().toLocaleDateString()}`);
    doc.moveDown(1);

    medicines.forEach(med => {
      doc.fontSize(13).font('Helvetica-Bold').fill('#0f172a')
        .text(`${med.name} (${med.dosage})`);
      doc.fontSize(9).font('Helvetica').fill('#64748b')
        .text(`Times: ${(med.times || []).join(' | ')}`);
      doc.moveDown(0.3);

      (med.confirmations || []).slice(-20).forEach(c => {
        doc.fontSize(9)
          .fill(c.confirmed ? '#22d3ee' : '#fb7185')
          .text(`${c.confirmed ? '✓' : '✗'}  ${new Date(c.time).toLocaleString()}`, 60);
      });
      doc.moveDown(0.8);
    });

    doc.end();
    } catch (error) {
      reject(error);
    }
  });
};

// ── Helpers ───────────────────────────────────────────────
function avg(arr) {
  const v = arr.filter(Boolean);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0;
}
function dominant(arr) {
  const f = {};
  arr.filter(Boolean).forEach(v => { f[v] = (f[v] || 0) + 1; });
  return Object.keys(f).sort((a, b) => f[b] - f[a])[0] || null;
}