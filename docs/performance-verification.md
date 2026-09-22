# Visual-Identical Performance Verification

Tanggal verifikasi: 2026-09-22 (UTC). Seluruh pengukuran dijalankan pada
worktree terisolasi branch `perf/visual-identical-optimization`. Prinsip
penerimaan utamanya adalah geometri dan tampilan harus tetap identik; optimasi
yang mengubah baseline gambar tidak diterima.

## Geometry equivalence

DXF kanonik menghasilkan 21.002 vertex dan 41.832 triangle. Parser legacy dan
streaming menghasilkan digest geometri yang sama persis:

`8fd2580cef69c33fb15a5035a9e2b7308c0617ea5e1b35357636514c11e21a3b`

Fixture penggantian mingguan juga identik pada kedua parser: 8 vertex, 6
triangle, dan digest
`84dd01dc560fa3df5c02c0ee3e184145578e113ff7778476b0ad9818aefb4e88`.

Hasil `node scripts/benchmark-dxf.mjs` pada DXF kanonik:

| Ukuran | Parser umum | Streaming `3DFACE` |
|---|---:|---:|
| Waktu parse | 760,208 ms | 316,935 ms |
| Peak heap teramati | 171.125.416 byte | 69.751.520 byte |
| Heap delta | 147.008.720 byte | 45.882.728 byte |
| Peak RSS | 321.081.344 byte | 160.038.912 byte |
| Vertex | 21.002 | 21.002 |
| Triangle | 41.832 | 41.832 |

Heap delta turun 68,789%, melewati activation gate 30%. Karena digest, vertex,
dan triangle juga sama, `USE_STREAMING_3DFACE` diaktifkan. DXF tanpa layout
`3DFACE` yang didukung atau DXF dengan pasangan group-code yang tidak aman
tetap diarahkan otomatis ke parser umum.

## Visual equivalence

Tujuh baseline Playwright berikut lulus dengan `maxDiffPixels: 0` dan tanpa
memperbarui file baseline:

- isometric;
- plan;
- front;
- side;
- solid color;
- wireframe; dan
- labels.

Percobaan membatch grid transparan pernah menghasilkan perbedaan 280 piksel
pada tampak depan dan ditolak. Implementasi final mempertahankan setiap garis
grid coplanar dalam urutan lama dan hanya membatch tick elevasi. Sesudah itu,
seluruh baseline kembali zero-diff.

## Network payload

| Artifact DXF kanonik | Byte | SHA-256 |
|---|---:|---|
| Raw | 16.758.246 | `ce8f3293b3358105cfc337dc50a4a1de096db72e8ffd892610c7231d13b2acca` |
| Gzip level 9 | 2.313.888 | `bed1ade4b2df44e5b76fe07a68e6d5b801e5c37434b5b77441931b86b1b92141` |

Gzip menghemat 14.444.358 byte atau 86,193%; payload menjadi 13,807% dari
raw. Dua build berurutan menghasilkan gzip dan manifest byte-identik. Pada
smoke test kanonik yang memuat halaman lalu reload, request tercatat sebagai
`manifest: 2`, `gzip: 1`, `raw: 0`: load kedua memakai cache dan tidak meminta
payload DXF lagi.

## Worker responsiveness

Smoke test artifact kanonik melaporkan `loaderSource: gzip` dan
`workerSource: worker`; parsing 41.832 triangle berlangsung di Web Worker.
Artifact pengganti mingguan juga memakai jalur worker dan selesai tanpa page
error. Suite memverifikasi worker progress, timeout, transfer buffer, request
ID stale, repeated reprocess, dan terminasi resource.

Jalur kompatibilitas juga diuji: kegagalan membuat Worker memakai parser
sinkron; kegagalan asynchronous sesudah Worker dibuat dan timeout juga memakai
salinan payload yang tetap utuh untuk fallback sinkron. Ketiadaan
`DecompressionStream` memakai raw DXF; kegagalan IndexedDB tidak menggagalkan
load; raw fallback, upload manual, dan recovery setelah file invalid semuanya
lulus. Manifest yang tampak valid tetapi memiliki hash, ukuran, atau path salah
diabaikan melalui satu retry bounded ke path DXF kanonik dan hasil recovery
tidak disimpan di cache dengan hash yang mencurigakan.

## Idle rendering

Pada artifact kanonik, scene stabil memiliki `pendingFrames: 0`. Counter
render tetap `3 → 3` setelah menunggu 300 ms dan shadow map memakai
`autoUpdate: false`. Artifact replacement memberikan hasil yang sama:
`pendingFrames: 0` dan render `3 → 3` setelah 300 ms.

## Draw calls

Pengukuran pertama pada data kanonik menemukan 29 draw calls walaupun fixture
kecil berada di bawah budget. Akar masalahnya adalah tick elevasi yang dibuat
sebagai objek `Line` terpisah. Batching tick dengan material identik menurunkan
hasil kanonik menjadi **23 draw calls**, termasuk 9 draw object monitoring,
tanpa perubahan screenshot. Artifact replacement memakai 9 draw calls. Kedua
hasil berada di bawah budget default `<25`. Budget tetap dikunci pada fixture
performa immutable; smoke test sumber produksi memvalidasi load dan idle state
secara dinamis agar perubahan bounds mingguan tidak ditolak oleh angka historis.

## Weekly replacement drill

Build dijalankan sekali dengan `data/topografi.dxf` kanonik dan sekali dengan
`tests/fixtures/terrain-sample.dxf` yang diinjeksi sebagai sumber produksi:

| Bukti | Kanonik | Replacement |
|---|---|---|
| Source SHA-256 | `ce8f3293b3358105cfc337dc50a4a1de096db72e8ffd892610c7231d13b2acca` | `68be966b6e99f9b42981429824ba97f7e8722d437abe0855039ec6150674470b` |
| Raw byte | 16.758.246 | 642 |
| Gzip byte | 2.313.888 | 158 |
| Vertex | 21.002 | 8 |
| Triangle | 41.832 | 6 |
| Cache key | `ce8f3293b335…:dxf-v1` | `68be966b6e99…:dxf-v1` |

Hash dan cache key berubah, manifest keduanya valid, dan build replacement
tidak memakai asumsi count historis. Smoke render artifact replacement memuat
gzip melalui worker, menampilkan 6 triangle, menghasilkan 0 page error, dan
tidak meminta raw fallback (`manifest: 1`, `gzip: 1`, `raw: 0`).

Perintah `npm run test:weekly` menjalankan seluruh 80 unit test dan 25 browser
test dengan fixture tersebut sebagai sumber produksi, kemudian membangun site
8-vertex/6-triangle. Ini memastikan assertion digest, jumlah triangle, bounds,
dan draw call historis tidak kembali memblokir penggantian mingguan.

## Post-review lifecycle hardening

Panah monitoring sekarang memakai origin lokal untuk shaft dan setiap grup
head. Rekonstruksi dari `Float32` BufferAttribute/instance matrix pada koordinat
northing sekitar 9 juta meter mempertahankan posisi hingga toleransi 0,00001 m.
Setiap `InstancedMesh` juga mengirim event `dispose`, dan test lifecycle Three.js
memastikan seluruh `instanceMatrix` GPU attribute lama dilepas saat update dan
dispose.

Viewer membedakan `pagehide.persisted`: halaman BFCache hanya disuspensi lalu
dirender ulang sekali pada `pageshow`, sedangkan navigasi final tetap melepas
scene. Jika CSV berhasil tetapi terrain gagal, aplikasi mempertahankan data
monitoring, menampilkan error topografi, dan membuka panel upload manual alih-
alih melaporkan mode Auto yang parsial.

## Reproducible commands

Ringkasan output run bersih:

```text
$ npm ci
added 22 packages in 19s

$ npm run build:site
Built _site: 21,002 vertices, 41,832 triangles, 2,313,888 gzip bytes

$ npm test
80 unit tests passed, 0 failed
25 browser tests passed, 0 failed

$ npm run test:weekly
80 unit tests passed, 0 failed
25 browser tests passed, 0 failed
Built _site: 8 vertices, 6 triangles, 158 gzip bytes

$ node scripts/benchmark-dxf.mjs
equivalent: true
heapImprovementRatio: 0.6878911128537137
activationGate.qualifies: true
```

`find _site -type l` menghasilkan tanpa output. Artifact Pages tidak memuat
symlink, `.git`, `node_modules`, test, ataupun report Playwright. Workflow hanya
memvalidasi pull request dan hanya men-deploy push `main` setelah job verifikasi
berhasil.
