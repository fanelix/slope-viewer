# Slope Monitor 3D Viewer

Web-based 3D visualization untuk slope monitoring: topografi DXF + vektor pergerakan titik monitoring.

## Cara Pakai

Buka URL GitHub Pages repo ini di browser. App akan:
1. Auto-load `data/topografi.dxf` dan `data/monitoring.csv` dari repo
2. Tampilkan visualisasi 3D interaktif

Kalau file tidak ada di repo, mode manual upload otomatis aktif.

## Update Data Bulanan

### Update CSV Monitoring

1. Buka repo di github.com
2. Navigate ke `data/monitoring.csv`
3. Klik icon pensil (Edit this file)
4. Paste data CSV baru (atau edit langsung)
5. Commit changes — GitHub Pages auto-deploy dalam 1-2 menit

Alternative: upload file CSV baru via "Add file → Upload files", replace yang lama.

### Update DXF Topografi (jarang)

1. Buka repo di github.com, navigate ke `data/`
2. Delete `topografi.dxf` lama
3. Upload DXF baru (rename jadi `topografi.dxf`)
4. Commit

## Format CSV

Header yang didukung (auto-detect, case-insensitive):

| Field | Alias yang diterima |
|-------|---------------------|
| ID | `ID`, `ID_POINT`, `POINT_ID`, `NAME`, `NAMA` |
| Easting awal | `E_AWAL`, `EASTING_AWAL`, `E0`, `X_AWAL` |
| Northing awal | `N_AWAL`, `NORTHING_AWAL`, `N0`, `Y_AWAL` |
| Elevasi awal | `EL_AWAL`, `ELEV_AWAL`, `Z_AWAL`, `ELEVASI_AWAL` |
| Easting akhir | `E_AKHIR`, `EASTING_AKHIR`, `E1`, `X_AKHIR` |
| Northing akhir | `N_AKHIR`, `NORTHING_AKHIR`, `N1`, `Y_AKHIR` |
| Elevasi akhir | `EL_AKHIR`, `ELEV_AKHIR`, `Z_AKHIR`, `ELEVASI_AKHIR` |

Unit: meter untuk koordinat, displacement dihitung otomatis dalam meter lalu ditampilkan dalam mm.

## Threshold Klasifikasi

| Kategori | Total Displacement | Warna |
|----------|---------------------|-------|
| Aman | ≤ 5 mm | Hijau |
| Waspada | 5–15 mm | Kuning |
| Bahaya | > 15 mm | Merah |

Untuk mengubah threshold, edit array `THRESHOLDS` di `index.html`.

## Parameter Topografi

- **Voxel size**: 2 m default. Turunkan ke 1 m untuk detail lebih baik (bench edges), naikkan ke 5 m kalau lambat.
- **Max slope filter**: 75° default, hardcoded di pemanggilan `triangulate(..., 75, 3)`.

## Privacy

Data (DXF dan CSV) tersimpan di repo ini. Kalau data sensitif:
- Pastikan repo **private** (Settings → General → Danger Zone → Change visibility)
- Pastikan Pages deployment juga private (Settings → Pages → Visibility)
