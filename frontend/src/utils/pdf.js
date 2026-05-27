/**
 * PDF rapor üretimi yardımcıları (Faz Ü7).
 *
 * jsPDF + jspdf-autotable lazy-load. İlk çağrıda kütüphane import edilir;
 * sonraki çağrılarda cache'lenir.
 *
 * Türkçe karakter sınırı: jsPDF default Helvetica fontu Latin-Extended-A
 * destekli unicode değil — ş/ç/ğ/ı/ö/ü/İ glyph'leri "?" olarak basılırdı.
 * Çözüm: tr2ascii() ile transliterasyon. PDF gözle okunabilir kalır
 * (Sahıp → Sahip, Çoklu → Coklu).
 *
 * Gelecek iyileştirme: Roboto TTF base64'ü VFS'e ekleyip addFont/setFont
 * ile gerçek unicode glyph desteği. Ek bundle ~170KB ama lazy chunk'ta
 * olduğu için yalnız PDF kullananlar öder.
 */

const TR_MAP = {
  ç: 'c', Ç: 'C',
  ğ: 'g', Ğ: 'G',
  ı: 'i', İ: 'I',
  ö: 'o', Ö: 'O',
  ş: 's', Ş: 'S',
  ü: 'u', Ü: 'U',
};

export function tr2ascii(s) {
  if (s == null) return '';
  const str = String(s);
  let out = '';
  for (const ch of str) out += TR_MAP[ch] !== undefined ? TR_MAP[ch] : ch;
  return out;
}

let pdfLibsPromise = null;
async function loadPdfLibs() {
  if (!pdfLibsPromise) {
    pdfLibsPromise = (async () => {
      const { jsPDF } = await import('jspdf');
      const autoTable = (await import('jspdf-autotable')).default;
      return { jsPDF, autoTable };
    })();
  }
  return pdfLibsPromise;
}

function fmtDateTR() {
  return new Date().toLocaleString('tr-TR').replace(/\./g, '/');
}

/**
 * Yeni PDF dokümanı + standart header/footer.
 *
 * @param {object} opts
 * @param {string} opts.baslik - PDF üst başlığı (örn "Ihlal Raporu")
 * @param {string} [opts.altBaslik] - başlık altı küçük satır (örn tarih aralığı)
 * @returns {Promise<{doc: jsPDF, addTable: (cfg) => void, save: (filename) => void}>}
 */
export async function newRaporPDF({ baslik, altBaslik }) {
  const { jsPDF, autoTable } = await loadPdfLibs();
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();

  // Header
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text(tr2ascii(baslik), 40, 50);
  if (altBaslik) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(100);
    doc.text(tr2ascii(altBaslik), 40, 68);
    doc.setTextColor(0);
  }

  // Üretim anı küçük not (sağ üst)
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(120);
  doc.text(`ParkTrack — ${fmtDateTR()}`, pageWidth - 40, 50, { align: 'right' });
  doc.setTextColor(0);

  function addTable(cfg) {
    // Tüm hücre verisini ASCII'ye çevir
    const head = (cfg.head || []).map((row) => row.map(tr2ascii));
    const body = (cfg.body || []).map((row) => row.map((c) => tr2ascii(c)));
    autoTable(doc, {
      head,
      body,
      startY: cfg.startY || 90,
      styles: { font: 'helvetica', fontSize: 9 },
      headStyles: { fillColor: [37, 99, 235], textColor: 255 }, // brand-600
      alternateRowStyles: { fillColor: [241, 245, 249] },
      ...cfg,
    });
  }

  function addFooter() {
    const total = doc.internal.getNumberOfPages();
    for (let i = 1; i <= total; i++) {
      doc.setPage(i);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(140);
      doc.text(`${i} / ${total}`, pageWidth - 40, pageHeight - 20, { align: 'right' });
      doc.setTextColor(0);
    }
  }

  function save(filename) {
    addFooter();
    doc.save(filename);
  }

  return { doc, addTable, save };
}
