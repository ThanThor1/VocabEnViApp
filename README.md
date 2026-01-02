# FunnyApp — Vocab + PDF Reader (Electron + Vite + React)

README này gồm **2 phần**:
1) **Hướng dẫn deploy / chạy app từ số 0** (dành cho người lần đầu clone repo)
2) **Giới thiệu chi tiết các chức năng** của app

---

## 1) Hướng dẫn deploy / chạy app (từ số 0)

### 1.1. Yêu cầu môi trường

Bạn cần cài:

- **Git** (để clone repo)
- **Node.js LTS** (khuyến nghị 18+ hoặc 20+)
- **npm** (đi kèm Node)

Nếu build installer trên Windows, bạn nên cài thêm:

- **Windows 10/11**
- (Khuyến nghị) **Visual Studio Build Tools** nếu Electron/native deps yêu cầu compile (thường không cần cho project này nhưng cài sẵn sẽ “đỡ đau”).

### 1.2. Clone dự án

```bash
git clone <repo-url>
cd FunnyApp
```

### 1.3. Cấu hình biến môi trường (Azure Translator) — nếu muốn dùng Auto Meaning

Tính năng **Auto Meaning theo ngữ cảnh** gọi Azure Translator **từ Electron main process**, nên **không lộ key ở renderer**.

Tạo file `.env` tại **root project** (cùng cấp với `package.json`):

```env
AZURE_TRANSLATOR_KEY=your_key_here
AZURE_TRANSLATOR_REGION=your_region_here
```

Ghi chú:

- Nếu không tạo `.env` thì app vẫn chạy, nhưng phần Auto Meaning sẽ báo lỗi/không tự gợi ý.
- Key/Region được load ở Electron main qua `dotenv`.

### 1.4. Cài dependency

```bash
npm install
```

Trong bước này project sẽ chạy `postinstall`:

- Script `scripts/copy-pdfjs-viewer.mjs` sẽ **copy PDF.js viewer** từ `node_modules/pdfjs-dist/web` vào `public/pdfjs/web`.
- Đây là phần quan trọng để PDF viewer (iframe) hoạt động.

### 1.5. Chạy app ở chế độ dev

```bash
npm run dev
```

App dev hoạt động như sau:

- Vite chạy tại `http://localhost:5173`
- Electron được launch và trỏ tới Vite qua `ELECTRON_START_URL`

### 1.6. Build production (đóng gói)

```bash
npm run build
```

Lệnh này sẽ:

1) `vite build` tạo bundle renderer
2) `electron-builder` đóng gói Electron app

Ghi chú:

- Hiện repo đã có `electron-builder` trong devDependencies.
- Nếu bạn muốn output theo chuẩn công ty (installer/signing/update channel…), cần bổ sung cấu hình `electron-builder` (thường đặt trong `package.json` mục `build` hoặc file `electron-builder.yml`).

### 1.7. Kiểm tra chất lượng code (khuyên chạy trước khi PR)

Typecheck:

```bash
npm run typecheck
```

Lint (hiện scope vào `src`):

```bash
npm run lint
```

Format:

```bash
npm run format:check
npm run format
```

### 1.8. Nơi app lưu dữ liệu

App lưu data vào thư mục userData của Electron:

- **CSV vocabulary**: `app.getPath('userData')/vocab-data/`
- **PDF data**: `app.getPath('userData')/Data/pdf/` (mỗi PDF là 1 folder theo `pdfId`)

Trong PDF folder sẽ có:

- `source.pdf` (bản copy)
- `meta.json` (metadata: baseName, deckCsvPath, …)
- `highlights.json` (rects highlight)
- `<baseName> vocab.csv` (deck từ vựng của PDF)

---

## 2) Giới thiệu chi tiết các chức năng

### 2.1. Vocabulary Manager (quản lý file CSV)

Màn **Manager** cho phép bạn quản lý dữ liệu từ vựng theo cấu trúc folder/file.

Các chức năng chính:

- **Folder tree / navigator**
	- Tạo folder
	- Tạo file CSV mới
	- Chọn file CSV để xem và chỉnh sửa
	- (Tuỳ UI hiện tại) thao tác rename/move/copy/delete cho file/folder

- **Add Word (thêm từ)**
	- Nhập `Word`, `Meaning` và **bắt buộc chọn `POS (Part of Speech)`** từ dropdown
	- IPA có thể được auto lookup (dictionaryapi.dev) ở một số luồng

- **Bảng từ vựng (VocabTable)**
	- Hiển thị các cột: `Word`, `Meaning`, `IPA`, `POS`
	- **Filter/Search** theo word/meaning
	- **Edit**: sửa Word/Meaning/IPA/POS
	- **Delete**
	- **Speak**: phát âm bằng Web Speech API
	- **Move selected / Copy selected**: chọn nhiều dòng và chuyển/copy sang file CSV khác

### 2.2. PDF Library + PDF Reader

Màn **PDF Reader** có 3 khối chính:

1) **PDF Library** (danh sách PDFs đã import)
2) **PDF Viewer** (iframe PDF.js)
3) **Vocab Deck panel** (thông tin deck từ vựng của PDF)

#### 2.2.1. Import PDF

- Chọn file `.pdf` từ máy
- App copy PDF vào thư mục data nội bộ và tạo `meta.json`
- App tạo deck CSV mặc định (hiện có header `word,meaning,pronunciation,pos`)

#### 2.2.2. Xem PDF + Zoom/Scroll

- Viewer dựa trên PDF.js (chạy trong iframe)
- Đã xử lý vấn đề zoom làm “kẹt” không kéo sang trái được (layout/scroll anchoring)

#### 2.2.3. Highlight + tooltip

- Khi bạn đã có từ vựng trong deck, highlight tương ứng trong PDF sẽ được render overlay
- Tooltip có thể hiển thị meaning/pronunciation (tuỳ highlight match)

### 2.3. Thêm từ mới bằng cách bôi đen trong PDF (use case quan trọng nhất)

Luồng hoạt động (tổng quan):

1) Bạn **bôi đen (select)** một từ/cụm từ trong PDF viewer
2) Viewer gửi event selection lên renderer (qua `postMessage`)
3) Renderer mở **AddWordModal**
4) Khi bạn Save:
	 - Từ được ghi vào CSV deck của PDF
	 - Highlight rects được lưu vào `highlights.json`
	 - Viewer nhận highlights mới để render overlay

Thông tin selection bao gồm:

- Text đã bôi
- Page number
- Rects (theo %)
- **Context sentence (EN)**: câu ngữ cảnh quanh selection (dùng cho Auto Meaning)

### 2.4. Auto Meaning theo ngữ cảnh (Azure Translator)

Khi AddWordModal mở (và user chưa gõ meaning thủ công):

- App gọi `window.api.autoMeaning` (IPC)
- Electron main process gọi Azure:
	- **Dictionary Lookup** để lấy danh sách candidates (có thể gồm POS tag)
	- **Translate** để dịch câu ngữ cảnh sang tiếng Việt
- App cố gắng **match candidate nghĩa** vào câu tiếng Việt đã dịch:
	- Nếu match tốt → auto điền `Meaning`
	- Nếu không tự tin → không auto điền, chỉ hiển thị danh sách gợi ý

UI trong modal:

- Hiển thị “Context (VI)”
- “Other suggestions”: click để set meaning nhanh
- POS có thể auto-select nếu Azure trả về `posTag` hợp lệ (nhưng sẽ không ghi đè nếu bạn đã chọn)

### 2.5. Part of Speech (POS) — bắt buộc và được lưu trong CSV

POS được thêm vào mọi nơi liên quan tới từ vựng:

- CSV schema có thêm cột `pos`
- AddWordModal/EditWordModal dùng dropdown (không nhập tay)
- VocabTable hiển thị cột POS

Backward compatibility:

- CSV cũ không có `pos` vẫn đọc được (pos sẽ là rỗng)
- Khi bạn ghi lại file (add/edit/move/copy), header mới sẽ được ghi theo schema mới

### 2.6. Study (học từ)

Màn **Study** cho phép:

- Chọn nhiều file CSV để tạo deck
- Shuffle deck
- Làm bài theo kiểu flashcard (ẩn chữ, nhập đáp án)
- Track đúng/sai và đưa từ sai vào danh sách review

### 2.7. Persisted state (nhớ trạng thái)

App có cơ chế lưu state vào localStorage cho một số màn hình:

- Filter word/meaning
- Selected rows
- Một số trạng thái chọn PDF / file

### 2.8. Troubleshooting

#### Auto Meaning không hoạt động

- Kiểm tra `.env` có `AZURE_TRANSLATOR_KEY` và `AZURE_TRANSLATOR_REGION`
- Restart app sau khi đổi `.env`

#### PDF viewer không hiển thị

- Chạy lại `npm install` để đảm bảo `postinstall` đã copy PDF.js viewer
- Kiểm tra folder `public/pdfjs/web` có `viewer.html`

