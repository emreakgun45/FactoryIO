# FactoryIO Simülatör 🏭

Stajyer eğitimi için endüstriyel otomasyon simülatörü.

## Kurulum

```bash
npm install
```

## Çalıştır (geliştirme)

```bash
npm start
```

## EXE Çıkar (Windows)

```bash
npm run build
```
Çıktı: `dist/` klasöründe `.exe` installer.

## Mac için

```bash
npm run build-mac
```

## Linux için

```bash
npm run build-linux
```

---

## Nasıl Kullanılır?

### Komponent Ekle
- **Sürükle bırak**: Sol panelden istediğin komponenti canvas'a sürükle
- **Tıkla ekle**: Komponent adına tıkla → sahneye otomatik eklenir

### Kontroller
| Eylem | Nasıl |
|-------|-------|
| Seç | Sol tık |
| Taşı | Seçili komponenti sürükle |
| Yeniden boyutlandır | Sağ alt köşedeki mavi kareyi sürükle |
| Döndür | Sağ tık → Döndür |
| Kopyala | Sağ tık → Kopyala |
| Sil | Sağ tık → Sil veya Properties'den Sil |
| Konveyör aç/kapat | Çift tıkla |
| Kapağı aç/kapat | Stopper'a çift tıkla |

### Simülasyon
- **▶ Başlat** → Hat çalışır, kaynak otomatik ürün üretir
- **⚠ Arıza** → Arıza enjekte et, hat durur
- **Hız Slider** → 1-8 arası ayarla

### Sahne Kaydet/Aç
- Menüden `Dosya > Kaydet` (Ctrl+S)
- `Dosya > Aç` ile tekrar yükle

---

## Komponent Listesi

| Komponent | Açıklama |
|-----------|----------|
| Yatay Konveyör | Ürünleri yatay taşır, yön ayarlanabilir |
| Dikey Konveyör | Ürünleri dikey taşır |
| Proximity Sensör | Ürün varlığı algılar, pistonları tetikler |
| Fotoelektrik | Işın kesen sensör |
| Renk Sensörü | Ürün rengini algılar |
| Piston / İtici | Sensör sinyaliyle otomatik tetiklenir |
| Robot Kol | Animasyonlu pick & place |
| Durdurma Kapağı | Çift tıkla aç/kapat, akışı durdurur |
| Ürün Kaynağı | Belirlenen aralıkta ürün üretir |
| Çıkış Noktası | Teslim sayacı gösterir |
| HMI Ekran | Toplam/başarılı/OEE gösterir |
