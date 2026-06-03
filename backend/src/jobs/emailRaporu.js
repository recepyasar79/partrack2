/**
 * Email rapor cron'u (Faz Ü7.2).
 *
 * Günde bir çalışır. Aktif (enabled=true) schedule'ları tarar; frequency
 * koşulları sağlanmışsa o gün için özet raporu HTML e-mail olarak gönderir
 * ve last_sent_at günceller.
 *
 * Frequency tetikleyici:
 *   daily   → her gün
 *   weekly  → Pazartesi (TR saat)
 *   monthly → ayın 1'i (TR saat)
 *
 * `last_sent_at` aynı gün ise tekrar göndermez (idempotent — cron iki kez
 * çalıştırılsa bile çift mail gitmez).
 *
 * SMTP yapılandırılmadıysa mailer no-op döner; cron yine de schedule
 * eligibility'yi günceller (last_sent_at) — dev/CI ortamında schedule
 * mantığı test edilebilir.
 */
const db = require('../db');
const { sendMail, isConfigured } = require('../services/mailer');
const { dayjs, TR_TZ, todayTR } = require('../utils/timezone');

function isDueToday(schedule, now = dayjs().tz(TR_TZ)) {
  const today = now.format('YYYY-MM-DD');
  if (schedule.last_sent_at) {
    const lastDate = dayjs(schedule.last_sent_at).tz(TR_TZ).format('YYYY-MM-DD');
    if (lastDate === today) return false; // aynı gün tekrar gönderme
  }
  if (schedule.frequency === 'daily') return true;
  if (schedule.frequency === 'weekly') return now.day() === 1; // Monday
  if (schedule.frequency === 'monthly') return now.date() === 1;
  return false;
}

async function collectOzet(siteId, baslangic, bitis) {
  const [ihlalRow, bildirimRow] = await Promise.all([
    db('ihlaller')
      .where({ site_id: siteId })
      .whereBetween('kontrol_tarihi', [baslangic, bitis])
      .select(
        db.raw(`COALESCE(SUM(CASE WHEN ihlal_tipi='coklu_arac' THEN 1 ELSE 0 END),0)::int as coklu_arac`),
        db.raw(`COALESCE(SUM(CASE WHEN ihlal_tipi='kayitsiz' THEN 1 ELSE 0 END),0)::int as kayitsiz`),
        db.raw(`COALESCE(SUM(CASE WHEN ihlal_tipi='kayitsiz' THEN jsonb_array_length(plaka_listesi) ELSE 0 END),0)::int as kayitsiz_plaka`),
        db.raw(`(COUNT(DISTINCT daire_id) FILTER (WHERE daire_id IS NOT NULL))::int as etkilenen_daire`)
      ).first(),
    db('bildirimler')
      .where({ site_id: siteId })
      .whereBetween('olusturma_zamani', [
        baslangic,
        dayjs.tz(bitis, TR_TZ).endOf('day').toISOString(),
      ])
      .select(
        db.raw(`COUNT(*)::int as toplam`),
        db.raw(`COALESCE(SUM(CASE WHEN gonderim_durumu='gonderildi' THEN 1 ELSE 0 END),0)::int as gonderildi`)
      ).first(),
  ]);
  const top = await db('ihlaller')
    .join('daireler', 'ihlaller.daire_id', 'daireler.id')
    .where('ihlaller.site_id', siteId)
    .whereBetween('ihlaller.kontrol_tarihi', [baslangic, bitis])
    .andWhere('ihlaller.ihlal_tipi', 'coklu_arac')
    .groupBy('daireler.id', 'daireler.daire_no', 'daireler.sahip_ad')
    .select(
      'daireler.daire_no',
      'daireler.sahip_ad',
      db.raw(`COUNT(*)::int as ihlal_sayisi`)
    )
    .orderBy('ihlal_sayisi', 'desc')
    .limit(5);
  // Detay: dönemdeki tüm ihlal kayıtları (daire + plakalar).
  const detay = await db('ihlaller')
    .leftJoin('daireler', 'ihlaller.daire_id', 'daireler.id')
    .where('ihlaller.site_id', siteId)
    .whereBetween('ihlaller.kontrol_tarihi', [baslangic, bitis])
    .select(
      'ihlaller.kontrol_tarihi',
      'ihlaller.ihlal_tipi',
      'ihlaller.plaka_listesi',
      db.raw('COALESCE(daireler.daire_no, ihlaller.daire_no_snapshot) as daire_no'),
      'daireler.sahip_ad'
    )
    .orderBy([
      { column: 'ihlaller.kontrol_tarihi', order: 'desc' },
      { column: 'daireler.daire_no', order: 'asc' },
    ]);
  return { ihlalRow, bildirimRow, top, detay };
}

function frequencyToDays(freq) {
  if (freq === 'weekly') return 7;
  if (freq === 'monthly') return 30;
  return 1;
}

/**
 * Rapor dönemini hesaplar. Cron sabah (Fly `daily` = 00:00 UTC = 03:00 TR)
 * çalıştığı için dönem **dün** biter — bugünün akşam kontrolü (20:00) henüz
 * yapılmadığından bugünü dahil etmek tüm rakamları 0 gösteriyordu.
 *
 *   daily   → [dün, dün]                (son tamamlanmış gün)
 *   weekly  → [dün-6, dün]              (7 günlük tamamlanmış pencere)
 *   monthly → [dün-29, dün]             (30 günlük tamamlanmış pencere)
 */
function reportWindow(frequency, now = dayjs().tz(TR_TZ)) {
  const bitis = now.subtract(1, 'day').format('YYYY-MM-DD');
  const baslangic = now.subtract(frequencyToDays(frequency), 'day').format('YYYY-MM-DD');
  return { baslangic, bitis };
}

function frequencyLabel(freq) {
  return { daily: 'Günlük', weekly: 'Haftalık', monthly: 'Aylık' }[freq] || freq;
}

function escapeHtml(s) {
  if (s == null) return '';
  return String(s)
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

function parsePlakalar(v) {
  if (Array.isArray(v)) return v;
  try { return JSON.parse(v || '[]'); } catch { return []; }
}

function fmtTarih(t) {
  if (!t) return '';
  return dayjs(t).tz(TR_TZ).format('YYYY-MM-DD');
}

function buildDetay(detay = []) {
  const coklu = detay.filter((d) => d.ihlal_tipi === 'coklu_arac');
  const kayitsiz = detay.filter((d) => d.ihlal_tipi === 'kayitsiz');
  if (!coklu.length && !kayitsiz.length) return '';

  const td = 'padding:6px 10px;border-bottom:1px solid #eee;';
  const cokluRows = coklu.map((d) => {
    const plakalar = parsePlakalar(d.plaka_listesi);
    return `
    <tr>
      <td style="${td}white-space:nowrap;color:#64748b;">${fmtTarih(d.kontrol_tarihi)}</td>
      <td style="${td}font-family:monospace;font-weight:bold;">${escapeHtml(d.daire_no || '—')}</td>
      <td style="${td}">${escapeHtml(d.sahip_ad || '—')}</td>
      <td style="${td}font-family:monospace;">${plakalar.map((p) => escapeHtml(p)).join(', ')}</td>
    </tr>`;
  }).join('');

  const kayitsizRows = kayitsiz.map((d) => {
    const plakalar = parsePlakalar(d.plaka_listesi);
    return `
    <tr>
      <td style="${td}white-space:nowrap;color:#64748b;">${fmtTarih(d.kontrol_tarihi)}</td>
      <td style="${td}font-family:monospace;">${plakalar.map((p) => escapeHtml(p)).join(', ')}</td>
    </tr>`;
  }).join('');

  const cokluTablo = coklu.length ? `
    <h3 style="margin:24px 0 8px;color:#0f172a;">Çoklu Araç İhlalleri (Detay)</h3>
    <table style="width:100%;border-collapse:collapse;font-size:14px;">
      <thead><tr style="background:#dc2626;color:white;">
        <th style="padding:8px 10px;text-align:left;">Tarih</th>
        <th style="padding:8px 10px;text-align:left;">Daire</th>
        <th style="padding:8px 10px;text-align:left;">Sahip</th>
        <th style="padding:8px 10px;text-align:left;">Plakalar</th>
      </tr></thead>
      <tbody>${cokluRows}</tbody>
    </table>` : '';

  const kayitsizTablo = kayitsiz.length ? `
    <h3 style="margin:24px 0 8px;color:#0f172a;">Kayıtsız Plakalar (Detay)</h3>
    <table style="width:100%;border-collapse:collapse;font-size:14px;">
      <thead><tr style="background:#d97706;color:white;">
        <th style="padding:8px 10px;text-align:left;">Tarih</th>
        <th style="padding:8px 10px;text-align:left;">Plakalar</th>
      </tr></thead>
      <tbody>${kayitsizRows}</tbody>
    </table>` : '';

  return cokluTablo + kayitsizTablo;
}

function buildDetayText(detay = []) {
  const coklu = detay.filter((d) => d.ihlal_tipi === 'coklu_arac');
  const kayitsiz = detay.filter((d) => d.ihlal_tipi === 'kayitsiz');
  let out = '';
  if (coklu.length) {
    out += '\nÇoklu araç ihlalleri:\n';
    out += coklu.map((d) => `  ${fmtTarih(d.kontrol_tarihi)} ${d.daire_no || '—'} (${d.sahip_ad || '—'}): ${parsePlakalar(d.plaka_listesi).join(', ')}`).join('\n');
    out += '\n';
  }
  if (kayitsiz.length) {
    out += '\nKayıtsız plakalar:\n';
    out += kayitsiz.map((d) => `  ${fmtTarih(d.kontrol_tarihi)}: ${parsePlakalar(d.plaka_listesi).join(', ')}`).join('\n');
    out += '\n';
  }
  return out;
}

function buildHtml({ siteAd, frequency, baslangic, bitis, ihlalRow, bildirimRow, top, detay }) {
  const toplam = (ihlalRow.coklu_arac || 0) + (ihlalRow.kayitsiz || 0);
  const basari_orani = bildirimRow.toplam > 0
    ? Math.round((bildirimRow.gonderildi / bildirimRow.toplam) * 1000) / 10 : 0;
  const topRows = top.map((d, i) => `
    <tr>
      <td style="padding:6px 10px;border-bottom:1px solid #eee;">${i + 1}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #eee;font-family:monospace;font-weight:bold;">${escapeHtml(d.daire_no)}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #eee;">${escapeHtml(d.sahip_ad || '—')}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right;font-weight:bold;">${d.ihlal_sayisi}</td>
    </tr>
  `).join('');

  return `<!doctype html>
<html lang="tr"><body style="font-family:Arial,sans-serif;color:#0f172a;max-width:640px;margin:0 auto;padding:24px;">
  <h2 style="color:#2563eb;margin:0 0 4px;">ParkTrack — ${frequencyLabel(frequency)} Özet</h2>
  <p style="color:#64748b;margin:0 0 24px;">${escapeHtml(siteAd)} • Dönem: ${baslangic} → ${bitis}</p>

  <table style="width:100%;border-collapse:collapse;margin-bottom:20px;">
    <tr>
      <td style="background:#f1f5f9;padding:12px;border-radius:8px;">
        <div style="font-size:11px;color:#64748b;text-transform:uppercase;">İhlal Kaydı</div>
        <div style="font-size:28px;font-weight:bold;color:#dc2626;">${toplam}</div>
        <div style="font-size:11px;color:#64748b;">${ihlalRow.coklu_arac} çoklu • ${ihlalRow.kayitsiz} kayıtsız</div>
      </td>
      <td style="padding:0 6px;"></td>
      <td style="background:#f1f5f9;padding:12px;border-radius:8px;">
        <div style="font-size:11px;color:#64748b;text-transform:uppercase;">Kayıtsız Plaka</div>
        <div style="font-size:28px;font-weight:bold;color:#d97706;">${ihlalRow.kayitsiz_plaka || 0}</div>
        <div style="font-size:11px;color:#64748b;">toplam araç</div>
      </td>
      <td style="padding:0 6px;"></td>
      <td style="background:#f1f5f9;padding:12px;border-radius:8px;">
        <div style="font-size:11px;color:#64748b;text-transform:uppercase;">Etkilenen Daire</div>
        <div style="font-size:28px;font-weight:bold;color:#d97706;">${ihlalRow.etkilenen_daire}</div>
      </td>
      <td style="padding:0 6px;"></td>
      <td style="background:#f1f5f9;padding:12px;border-radius:8px;">
        <div style="font-size:11px;color:#64748b;text-transform:uppercase;">Bildirim Başarı</div>
        <div style="font-size:28px;font-weight:bold;color:#059669;">%${basari_orani}</div>
        <div style="font-size:11px;color:#64748b;">${bildirimRow.gonderildi}/${bildirimRow.toplam} gönderildi</div>
      </td>
    </tr>
  </table>

  ${top.length ? `
    <h3 style="margin:24px 0 8px;color:#0f172a;">En Çok İhlal Yapan Daireler</h3>
    <table style="width:100%;border-collapse:collapse;font-size:14px;">
      <thead><tr style="background:#2563eb;color:white;">
        <th style="padding:8px 10px;text-align:left;">#</th>
        <th style="padding:8px 10px;text-align:left;">Daire</th>
        <th style="padding:8px 10px;text-align:left;">Sahip</th>
        <th style="padding:8px 10px;text-align:right;">İhlal</th>
      </tr></thead>
      <tbody>${topRows}</tbody>
    </table>
  ` : '<p style="color:#64748b;">Bu dönemde ihlal kaydı yok.</p>'}

  ${buildDetay(detay)}

  <p style="color:#94a3b8;font-size:12px;margin-top:24px;">
    Bu rapor otomatik olarak gönderildi. Aboneliği yönetmek için Raporlar
    sayfasındaki "Email Aboneliği" bölümünü kullanın.
  </p>
</body></html>`;
}

async function runEmailRaporu(now = dayjs().tz(TR_TZ)) {
  const schedules = await db('report_schedules')
    .where({ enabled: true })
    .select('*');

  const result = { total: schedules.length, sent: 0, skipped: 0, failed: 0, mock: 0 };

  for (const s of schedules) {
    if (!isDueToday(s, now)) { result.skipped++; continue; }

    const { baslangic, bitis } = reportWindow(s.frequency, now);

    try {
      const site = await db('sites').where({ id: s.site_id }).select('ad').first();
      const data = await collectOzet(s.site_id, baslangic, bitis);
      const html = buildHtml({
        siteAd: site?.ad || 'ParkTrack Sitesi',
        frequency: s.frequency,
        baslangic, bitis,
        ...data,
      });
      const subject = `ParkTrack ${frequencyLabel(s.frequency)} Özet — ${site?.ad || ''} (${bitis})`;
      const text = `${subject}\n\nDönem: ${baslangic} → ${bitis}\nİhlal kaydı: ${(data.ihlalRow.coklu_arac || 0) + (data.ihlalRow.kayitsiz || 0)} (${data.ihlalRow.coklu_arac || 0} çoklu • ${data.ihlalRow.kayitsiz || 0} kayıtsız)\nKayıtsız plaka: ${data.ihlalRow.kayitsiz_plaka || 0}\nEtkilenen daire: ${data.ihlalRow.etkilenen_daire}\nBildirim başarı: ${data.bildirimRow.toplam ? Math.round((data.bildirimRow.gonderildi / data.bildirimRow.toplam) * 100) : 0}%\n${buildDetayText(data.detay)}`;

      const r = await sendMail({ to: s.email, subject, html, text });
      if (r.ok) {
        await db('report_schedules').where({ id: s.id }).update({
          last_sent_at: db.fn.now(),
          updated_at: db.fn.now(),
        });
        if (r.mock) result.mock++;
        result.sent++;
      } else {
        result.failed++;
        // eslint-disable-next-line no-console
        console.warn(`[emailRaporu] schedule ${s.id} fail:`, r.error);
      }
    } catch (err) {
      result.failed++;
      // eslint-disable-next-line no-console
      console.warn(`[emailRaporu] schedule ${s.id} error:`, err.message);
    }
  }

  return result;
}

if (require.main === module) {
  (async () => {
    try {
      const r = await runEmailRaporu();
      // eslint-disable-next-line no-console
      console.log('[emailRaporu]', r, isConfigured() ? '(SMTP configured)' : '(SMTP not configured — mock)');
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[emailRaporu] fatal:', err);
      process.exit(1);
    } finally {
      await db.destroy();
    }
  })();
}

module.exports = { runEmailRaporu, isDueToday, buildHtml, frequencyLabel, reportWindow, buildDetay };
