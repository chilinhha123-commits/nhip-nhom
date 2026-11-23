# Hướng dẫn cài đặt Nhịp Nhóm

Ứng dụng gồm giao diện React + TypeScript, API Node.js/Express và lưu dữ liệu trong MongoDB database `nhip_nhom` khi có `MONGODB_URI`; nếu không có biến này, ứng dụng dùng `server/data/store.json`. Kho dữ liệu ban đầu trống; mỗi người tạo workspace riêng và có thể thêm thành viên bằng email.

## 1. Yêu cầu

- Node.js 20.19 trở lên và npm.
- Trình duyệt hiện đại.
- Tùy chọn: tài khoản Google Cloud để bật đăng nhập Gmail; tài khoản Gmail có xác minh 2 bước để gửi email nhắc hạn.

Kiểm tra cài đặt:

```powershell
node --version
npm.cmd --version
```

## 2. Cài thư viện và chạy ứng dụng

Mở PowerShell tại thư mục dự án, sau đó chạy:

```powershell
npm.cmd install
npm.cmd run dev
```

File `.env` đã có sẵn với cấu hình demo. Mở file này để điền thông tin Google, MongoDB và email ở các bước bên dưới. Mở **http://localhost:5173**, đăng nhập demo bằng email của bạn hoặc đăng nhập Google, sau đó tạo workspace. Không có thành viên hay nhiệm vụ mẫu được tạo sẵn. Khi chưa đặt `MONGODB_URI`, dữ liệu được lưu trên máy trong `server/data/store.json`; tệp tải lên được lưu trong `server/uploads/`.

Trên PowerShell Windows, dùng `npm.cmd` nếu chính sách thực thi chặn `npm.ps1`. Nếu vừa cài Node.js mà lệnh chưa nhận ra, hãy mở terminal mới hoặc khởi động lại VS Code.

Có thể khởi chạy cả giao diện và API bằng cách nhấp đúp [CHAY_UNG_DUNG.bat](./CHAY_UNG_DUNG.bat) ở thư mục dự án. Batch sẽ tự kiểm tra Node.js, tạo `.env` từ file mẫu nếu chưa có, cài thư viện khi thiếu và giữ cửa sổ mở để xem log. Nhấn **Ctrl+C** để dừng.

Chế độ production:

```powershell
npm.cmd run build
npm.cmd start
```

Sau đó mở **http://localhost:4000**.

## 3. Bật đăng nhập bằng Google/Gmail

1. Mở [Google Cloud Console](https://console.cloud.google.com/) và chọn hoặc tạo một project.
2. Trong **Google Auth Platform / OAuth consent screen**, cấu hình thông tin ứng dụng. Khi ứng dụng ở chế độ Testing, thêm tài khoản Gmail của bạn vào **Test users**.
3. Vào **Clients** (hoặc **APIs & Services → Credentials**) → **Create client** → **Web application**.
4. Thêm địa chỉ sau vào **Authorized JavaScript origins**:
   - `http://localhost:5173`
   - Nếu triển khai nơi khác, thêm origin HTTPS của ứng dụng.
5. Tạo client và sao chép **Client ID** (dạng `...apps.googleusercontent.com`).
6. Mở `.env`, điền:

   ```dotenv
   GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
   DEMO_MODE=true
   ```

7. Khởi động lại máy chủ. Trang đăng nhập sẽ có nút Google. Máy chủ xác minh ID token với Google và chỉ chấp nhận địa chỉ `@gmail.com` đã xác minh.
8. Khi muốn tắt chế độ dùng thử, đặt `DEMO_MODE=false`. Khi đó người dùng cần đăng nhập Google; không có Gmail hợp lệ thì không thể truy cập API.

Không đưa `.env` lên GitHub hoặc chia sẻ Client Secret/credential. Ứng dụng này chỉ cần Client ID; không cần OAuth Client Secret ở trình duyệt.

## 4. Bật email phân công và nhắc hạn

1. Tạo API key trong tài khoản Brevo và xác minh địa chỉ người gửi `chilinhha123@gmail.com` tại Brevo.
2. Điền `.env`:

   ```dotenv
   BREVO_API_KEY=your-brevo-api-key
   ```

3. Nếu không cấu hình Brevo, ứng dụng dùng SMTP Gmail dự phòng:

   ```dotenv
   GMAIL_USER=dia-chi-gmail-cua-ban@gmail.com
   GMAIL_APP_PASSWORD=mat-khau-ung-dung-16-ky-tu
   ```

4. Khởi động lại `npm run dev`. Khi tạo nhiệm vụ, ứng dụng gửi email riêng tới các địa chỉ hợp lệ trong ba vai trò được phân công; máy chủ kiểm tra mỗi phút để gửi nhắc hạn. Nhiệm vụ đã hoàn thành sẽ không nhận nhắc hạn.
5. Để kiểm tra email thật, dùng địa chỉ Gmail của các thành viên đã thêm vào workspace.

Thêm thành viên bằng email sẽ lưu địa chỉ đó vào workspace. Thành viên cần đăng nhập bằng đúng email đã thêm để thấy workspace; lời mời hiện chưa gửi email riêng.

Nếu chưa cấu hình email, ứng dụng vẫn chạy bình thường và báo rõ rằng email chưa được gửi. Nhật ký lỗi gửi email nằm trong terminal đang chạy máy chủ.

## 5. AI lập kế hoạch & phân công

Thêm `GEMINI_API_KEY` vào `.env` khi chạy cục bộ hoặc vào **Render → Web Service → Environment** khi triển khai. API key chỉ được dùng ở backend, không đưa vào frontend hay commit vào Git. Mặc định ứng dụng gọi `gemini-3.8-flash`; có thể đặt `GEMINI_MODEL` thành model Gemini khác để đổi model.

Trong tab **Thành viên**, mỗi thành viên hoặc trưởng nhóm có thể cập nhật thẻ điểm mạnh và ghi chú ngắn. Hồ sơ được lưu riêng theo workspace trong MongoDB `nhip_nhom` (hoặc `store.json` nếu đang dùng chế độ fallback). Ở tab **Bảng việc**, nút **AI lập kế hoạch** tạo bản nháp từ mô tả dự án, sở trường và số việc chưa hoàn thành của thành viên. Hãy xem lại/chỉnh sửa kế hoạch trước khi áp dụng; các nhiệm vụ được lưu qua API tạo nhiệm vụ hiện có.

Khi Gemini trả HTTP 503, máy chủ thử lại tối đa một lần sau 2,5 giây rồi chuyển từ model chính sang `gemini-3.5-flash-lite`. Với HTTP 429, máy chủ dừng yêu cầu mới và giao diện báo chờ khoảng 60 giây trước khi thử lại.

### Thiết lập email trên Render

Trong Render Dashboard, mở **Web Service → Environment** rồi thêm các biến sau:

| Biến | Giá trị |
|---|---|
| `BREVO_API_KEY` | Brevo API key; ưu tiên sử dụng khi có cấu hình |
| `GMAIL_USER` | Gmail dùng gửi email dự phòng, ví dụ `ten-cua-ban@gmail.com` |
| `GMAIL_APP_PASSWORD` | App Password Gmail dùng làm SMTP dự phòng |
| `MONGODB_URI` | MongoDB Atlas connection string; database `nhip_nhom` |
| `GEMINI_API_KEY` | Google AI Studio API key dùng lập kế hoạch ở backend |
| `GEMINI_MODEL` | *(không bắt buộc)* `gemini-3.8-flash` |

Sau khi thêm biến, nhấn **Save Changes** để Render triển khai lại dịch vụ. Các biến tùy chọn khác vẫn có thể cấu hình như `GOOGLE_CLIENT_ID`, `DEMO_MODE`, `CLIENT_ORIGIN` và `PORT`. Máy chủ kiểm tra hạn nhiệm vụ khi khởi động và sau đó mỗi phút; nó lưu `remindersSent` trong kho dữ liệu đang cấu hình để không gửi trùng.

Nếu chọn **Giờ báo lại cụ thể**, giao diện trình duyệt tự chuyển giờ địa phương thành ISO UTC trước khi gửi lên server, nên Render so sánh đúng thời điểm thực tế. Máy chủ quét mỗi phút và chỉ gửi trong vòng 30 phút kể từ giờ đã đặt. Nhật ký Logs ghi rõ lý do, thời điểm định gửi và chi tiết lỗi dịch vụ email.

## 6. Bật lưu trữ MongoDB Atlas

1. Tạo database trên MongoDB Atlas và tạo database user có quyền đọc/ghi.
2. Trong **Network Access**, cho phép dịch vụ Render kết nối. Sao chép connection string dạng `mongodb+srv://...`; thay phần mật khẩu mẫu bằng mật khẩu database user đã mã hóa URL nếu có ký tự đặc biệt.
3. Thêm connection string dạng `mongodb://...` vào `MONGODB_URI` trong Render Dashboard → **Web Service → Environment**. Nếu chỉ có URI dạng `mongodb+srv://...` hoặc muốn dùng kết nối trực tiếp khi `MONGODB_URI` trống, đặt URI chuẩn `mongodb://...` vào biến bảo mật `MONGODB_DIRECT_URI`. Không đặt thông tin xác thực trong mã nguồn. Ứng dụng luôn chọn database `nhip_nhom`.
4. Nhấn **Save Changes** để triển khai lại. Khi cấu hình URI lần đầu, nếu collection chưa có dữ liệu, ứng dụng khởi tạo MongoDB từ `server/data/store.json` hiện có (nếu tồn tại); các lần sau MongoDB là kho dữ liệu chính. Nếu bỏ `MONGODB_URI`, ứng dụng quay lại lưu file JSON.

## 7. Các chức năng hiện có

- Bảng Kanban và danh sách, lọc trạng thái/ưu tiên, tìm kiếm và thống kê.
- Tạo nhiều workspace riêng, chuyển đổi giữa các workspace, mời thành viên theo email và tách dữ liệu bảng theo workspace.
- Mỗi workspace có mã mời để thành viên xem/sao chép; người dùng có thể tham gia nhóm bằng mã này.
- Tạo/chỉnh sửa nhiệm vụ, ba vai trò riêng biệt, chọn người kiểm tra thủ công hoặc random trong số thành viên còn lại.
- Đồng hồ đếm ngược từng giây, cảnh báo màu đỏ khi còn dưới 24 giờ hoặc quá hạn.
- Email thông báo khi giao nhiệm vụ và email nhắc hạn 24 giờ/1 giờ nếu đã cấu hình Gmail.
- Chi tiết nhiệm vụ có liên kết/tệp đính kèm (tối đa 15 MB), bình luận lưu bền và cập nhật trực tiếp qua Socket.IO.

## 8. Cấu hình và lưu trữ

Các biến môi trường có trong `.env.example`:

| Biến | Mặc định | Ý nghĩa |
|---|---|---|
| `PORT` | `4000` | Cổng API và ứng dụng production |
| `CLIENT_ORIGIN` | `http://localhost:5173` | Origin được phép kết nối khi phát triển |
| `DEMO_MODE` | `true` | Cho phép đăng nhập thử bằng email mà không xác minh Google; tắt để yêu cầu đăng nhập Google |
| `GOOGLE_CLIENT_ID` | *(trống)* | Google OAuth Client ID |
| `MONGODB_URI` | *(trống)* | MongoDB Atlas URI; database được chọn là `nhip_nhom`; nếu trống dùng file JSON |
| `MONGODB_DIRECT_URI` | *(trống)* | MongoDB URI chuẩn `mongodb://` dùng khi `MONGODB_URI` trống hoặc dùng `mongodb+srv://` |
| `BREVO_API_KEY` | *(trống)* | Brevo HTTP API key gửi email; ưu tiên hơn SMTP |
| `GMAIL_USER` | *(trống)* | Gmail gửi email dự phòng |
| `GMAIL_APP_PASSWORD` | *(trống)* | App Password Gmail dùng SMTP dự phòng |
| `SMTP_PORT` | `587` | Cổng Gmail SMTP; dùng `465` để bật SMTPS hoặc `587` để dùng STARTTLS |
| `GEMINI_API_KEY` | *(trống)* | Google AI Studio API key; chỉ dùng từ backend |
| `GEMINI_MODEL` | `gemini-3.8-flash` | Model Gemini; có thể đặt model Gemini khác |

Khi cấu hình `MONGODB_URI`, thông tin tài khoản, workspace và nhiệm vụ lưu trong MongoDB Atlas; nếu không, ứng dụng dùng file JSON cục bộ. Tệp tải lên vẫn nằm trong `server/uploads/`. Chế độ demo không xác minh danh tính email, chỉ nên dùng để thử nghiệm cục bộ. Khi triển khai công khai, hãy cấu hình HTTPS, sao lưu dữ liệu và bảo vệ tệp `.env`/thư mục uploads.
