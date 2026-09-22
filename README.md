# Slope Monitor 3D Viewer

Visualisasi 3D berbasis web untuk topografi DXF dan vektor pergerakan titik
monitoring. Aplikasi berjalan sebagai situs statis GitHub Pages; parsing DXF,
cache, dan visualisasi dilakukan di browser.

## Cara Pakai

Buka URL GitHub Pages repositori ini. Aplikasi akan memuat otomatis:

1. `data/topografi.dxf` untuk topografi; dan
2. `data/monitoring.csv` untuk titik monitoring.

Jika data repo tidak tersedia, panel upload manual tetap dapat digunakan untuk
DXF saja, CSV saja, atau keduanya.

## Pembaruan Data

### Update CSV Monitoring

1. Buka `data/monitoring.csv` melalui GitHub web.
2. Klik ikon pensil untuk mengedit, atau gunakan **Add file → Upload files**
   untuk mengganti file dengan nama yang sama.
3. Commit perubahan sesuai aturan branch repositori.
4. Pastikan workflow **Verify and deploy GitHub Pages** berhasil.

### Update DXF Topografi Mingguan — Browser Only

Penggantian mingguan hanya memerlukan satu perubahan sumber. Jangan membuat,
mengedit, atau mengunggah `topografi.dxf.gz` maupun `assets-manifest.json`;
keduanya dibuat otomatis oleh workflow.

1. Siapkan DXF baru dengan ukuran **di bawah 25 MiB**. Jika ukurannya 25 MiB
   atau lebih, berhenti dan gunakan jalur ingestion alternatif yang telah
   disetujui—jangan upload file lebih besar melalui browser GitHub.
2. Pertahankan **nama dan path yang sama**, yaitu `data/topografi.dxf`.
   Pertahankan pula sistem koordinat proyek yang sama (Easting, Northing, dan
   elevasi dalam meter) serta konvensi entity topografi **3DFACE**. Entity
   `LINE`, `LWPOLYLINE`, `POLYLINE`, dan `POINT` didukung sebagai mode point
   cloud, tetapi jangan berpindah konvensi tanpa verifikasi teknis.
3. Di GitHub web, buka folder `data/`, pilih **Add file → Upload files**, lalu
   unggah `topografi.dxf` baru untuk menggantikan file pada path tersebut.
   Commit langsung ke `main` atau selesaikan pull request sesuai perlindungan
   branch yang berlaku.
4. Buka tab **Actions** dan pastikan job `verify` berhasil. Untuk commit yang
   sudah masuk `main`, pastikan job `deploy` juga berhasil. Pull request hanya
   menjalankan validasi dan tidak melakukan deployment.
5. Jika validasi gagal, perbaiki sumber DXF dan jalankan ulang. Validasi gagal
   tidak mengganti situs; deployment terakhir yang sukses tetap live.
6. Setelah deployment sukses, buka aplikasi dengan akhiran `?test=1`. Di
   Developer Tools → Console jalankan:

   ```js
   window.__SLOPE_VIEWER_TEST_API__.diagnostics().shortSourceHash
   ```

   Bandingkan **short source hash** tersebut dengan 12 karakter pertama nilai
   `dxf.sha256` pada `data/assets-manifest.json` di situs Pages. Terima update
   mingguan hanya setelah nilainya sama dan topografi tampil normal.

Vertex, triangle, dan bounding box boleh berubah mengikuti topografi mingguan.
Workflow akan memvalidasi struktur geometri, menghasilkan gzip deterministik,
memperbarui manifest/hash cache, menjalankan seluruh tes, lalu men-deploy hanya
jika semua pemeriksaan berhasil.

## Format CSV

Header dideteksi otomatis tanpa membedakan huruf besar/kecil:

| Field | Alias yang diterima |
|---|---|
| ID | `ID`, `ID_POINT`, `POINT_ID`, `NAME`, `NAMA` |
| Easting awal | `E_AWAL`, `EASTING_AWAL`, `E0`, `X_AWAL` |
| Northing awal | `N_AWAL`, `NORTHING_AWAL`, `N0`, `Y_AWAL` |
| Elevasi awal | `EL_AWAL`, `ELEV_AWAL`, `Z_AWAL`, `ELEVASI_AWAL` |
| Easting akhir | `E_AKHIR`, `EASTING_AKHIR`, `E1`, `X_AKHIR` |
| Northing akhir | `N_AKHIR`, `NORTHING_AKHIR`, `N1`, `Y_AKHIR` |
| Elevasi akhir | `EL_AKHIR`, `ELEV_AKHIR`, `Z_AKHIR`, `ELEVASI_AKHIR` |

Koordinat menggunakan meter. Displacement dihitung dalam meter dan ditampilkan
dalam milimeter.

## Threshold Klasifikasi

| Kategori | Total displacement | Warna |
|---|---:|---|
| Aman | ≤ 5 mm | Hijau |
| Waspada | > 5–15 mm | Kuning |
| Bahaya | > 15 mm | Merah |

Konfigurasi threshold dan alias kolom berada di `src/config.js`.

## Parameter Topografi

- Z exaggeration default: `6×`.
- Opacity default: `90%`.
- Max slope default: `90°` atau tanpa filter slope.
- Max edge default: tak terbatas.
- Voxel default: `2 m`, hanya untuk sumber point cloud.

Perubahan voxel/slope/edge diterapkan setelah menekan tombol **Proses Ulang
dengan Parameter Baru**.

## Pengembangan Lokal

```bash
npm ci
npm test
npm run build:site
```

Build produksi dibuat di `_site/`. File gzip dan manifest hanya merupakan
artifact build dan tidak perlu dikomit.

## Privasi

DXF dan CSV tersimpan di repositori serta artifact Pages. Pastikan pengaturan
akses repositori dan visibilitas Pages sesuai klasifikasi data perusahaan.
