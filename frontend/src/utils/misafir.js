// Misafir araç "halen içeride" mantığı — MisafirAraclar listesi ve Akşam
// Kontrolü ekranlarında ortak kullanılır (tek kaynak, görsel tutarlılık).

export function bugunStr() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// "Halen içeride" = bugün, kaydın tarih aralığında (baslangic <= bugün <= bitis).
// Tarih bazlı karşılaştırma (ISO string'in ilk 10 karakteri yeterli).
export function icerideMi(m, bugun = bugunStr()) {
  const b = (m.baslangic_tarihi || '').slice(0, 10);
  const e = (m.bitis_tarihi || '').slice(0, 10);
  return Boolean(b) && Boolean(e) && b <= bugun && bugun <= e;
}
