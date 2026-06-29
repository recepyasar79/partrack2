"""extract_plate / _search_plate testleri — permütasyon kapısı (2026-06-29).

Saha bulgusu: küçük kutular (telefon/reklam/"TR" ülke kodu) permütasyona
girince geçerli FORMATTA ama semantik YANLIŞ plaka uyduruyordu
(all/permuted 5 okumanın 3'ü yanlış). İri kutularda permütasyon mükemmel
(big/permuted 22/0). Fix: permütasyon yalnız iri kutularda; big+small
fallback'inde KAPALI → bulamazsa None (görevli elle yazar / PR devreye girer).

EasyOCR ağır modelini yüklememek için import öncesi stub'lanır; testler yalnız
saf fonksiyonları (cv2/model gerektirmez) çağırır.
"""
import sys
import types

# --- EasyOCR'ı import'tan ÖNCE stub'la (app.py modül seviyesinde Reader kurar) ---
_fake_easyocr = types.ModuleType("easyocr")
class _StubReader:
    def __init__(self, *a, **k):
        pass
    def readtext(self, *a, **k):
        return []
_fake_easyocr.Reader = _StubReader
sys.modules.setdefault("easyocr", _fake_easyocr)

import app  # noqa: E402


def test_big_permuted_still_works():
    """İri kutularda bölünmüş plaka permütasyonla toparlanmaya devam eder.
    Saha doğru okuması: '493 BC 34' → 34BC493 (big/permuted 22/0)."""
    dets = [("493", 0.9, 30.0), ("BC", 0.9, 30.0), ("34", 0.9, 30.0)]
    plate, conf, strat = app.extract_plate(dets)
    assert plate == "34BC493", plate
    assert strat.startswith("big/"), strat
    assert "permuted" in strat, strat


def test_big_joined_normal_plate():
    """Tek iri kutuda tam plaka — regresyon emniyeti."""
    dets = [("34ABC123", 0.9, 30.0)]
    plate, _conf, strat = app.extract_plate(dets)
    assert plate == "34ABC123", plate
    assert strat.startswith("big/"), strat


def test_small_box_permutation_no_longer_manufactures_plate():
    """ASIL FIX: plaka yalnız iri-noise + küçük kutuların PERMÜTASYONUyla
    oluşabiliyorsa artık None dönmeli (eski kod sahte plaka uydururdu).

    Kurgu: tek iri kutu plaka değil ('WWW'); küçük kutular ('ACF47','34') sıralı
    join'de plaka VERMEZ ('WWWACF4734' içinde geçerli plaka yok), yalnız yeniden
    sıralanınca '34ACF47' olur. Eski all/permuted bunu döndürürdü; yeni big+small
    (permute kapalı) None döner → görevli elle yazar / PR. (Ambiguous olmayan
    karakterler seçildi ki char_variants takası araya girmesin.)"""
    dets = [("WWW", 0.5, 30.0), ("ACF47", 0.5, 12.0), ("34", 0.5, 12.0)]
    plate, _conf, strat = app.extract_plate(dets)
    assert plate is None, f"sahte plaka uyduruldu: {plate} ({strat})"


def test_search_plate_permute_flag():
    """_search_plate allow_permute kapısı doğrudan."""
    items = [("493", 0.9), ("BC", 0.9), ("34", 0.9)]
    # permute açık → bulur
    found = app._search_plate(items, allow_permute=True)
    assert found and found[0] == "34BC493", found
    assert found[2] == "permuted", found
    # permute kapalı → sıralı join/single plaka veremez → None
    assert app._search_plate(items, allow_permute=False) is None


def test_all_joined_in_order_still_rescues():
    """big+small fallback'i joined(okuma sırası) ile hâlâ kurtarabilir;
    yalnız permütasyon kapandı. İri noise + küçük kutuda plaka okuma
    SIRASINDA duruyorsa joined yakalar."""
    # büyük noise + küçük kutuda sıralı tam plaka '34ACF47'
    dets = [("WWW", 0.5, 30.0), ("34ACF47", 0.6, 12.0)]
    plate, _conf, strat = app.extract_plate(dets)
    assert plate == "34ACF47", plate
    assert strat.startswith("all/"), strat
    assert "joined" in strat or "single" in strat, strat


if __name__ == "__main__":
    import traceback
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    failed = 0
    for fn in fns:
        try:
            fn()
            print(f"PASS {fn.__name__}")
        except Exception:
            failed += 1
            print(f"FAIL {fn.__name__}")
            traceback.print_exc()
    print(f"\n{len(fns) - failed}/{len(fns)} geçti")
    sys.exit(1 if failed else 0)
