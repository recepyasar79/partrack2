export const BLOKLAR = ['A', 'B', 'C', 'D'];
export const SIRA_MIN = 1;
export const SIRA_MAX = 34;

export function tumDaireler() {
  const list = [];
  for (const blok of BLOKLAR) {
    for (let s = SIRA_MIN; s <= SIRA_MAX; s++) {
      list.push(`${blok}${s}`);
    }
  }
  return list;
}

export const TOKEN_KEY = 'parktrack_token';
export const USER_KEY = 'parktrack_user';

export const KVKK_METNI = `Site otopark yönetim sistemi (ParkTrack), site sakinlerinin araç plakaları ve iletişim
bilgilerini, gece konaklama kuralının (her dairenin tek aracının site otoparkında gece
geçirebilmesi) takibi amacıyla işler. Toplanan veriler: sahip ad-soyad, telefon, plaka,
KVKK rıza tarihi. Veri saklama süresi: aktif sakinlik süresince + 90 gün. Kişi, dilediği
zaman site yönetiminden silme/güncelleme talep edebilir.`;
