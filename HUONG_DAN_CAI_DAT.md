# Hướng dẫn cài đặt Nhịp Nhóm

Ứng dụng gồm giao diện React + TypeScript, API Node.js/Express và dữ liệu lưu cục bộ trong `server/data/store.json`. Kho dữ liệu ban đầu trống; mỗi người tạo workspace riêng và có thể thêm thành viên bằng email.

## 1. Yêu cầu

- Node.js 20 trở lên và npm.
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

File `.env` đã có sẵn với cấu hình demo. Mở file này để điền thông tin Google/Gmail ở các bước bên dưới. Mở **http://localhost:5173**, đăng nhập demo bằng email của bạn hoặc đăng nhập Google, sau đó tạo workspace. Không có thành viên hay nhiệm vụ mẫu được tạo sẵn. Dữ liệu được lưu trên máy trong `server/data/store.json`; tệp tải lên được lưu trong `server/uploads/`.

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

### Thiết lập email trên Render

Trong Render Dashboard, mở **Web Service → Environment** rồi thêm các biến sau:

| Biến | Giá trị |
|---|---|
| `BREVO_API_KEY` | Brevo API key; ưu tiên sử dụng khi có cấu hình |
| `GMAIL_USER` | Gmail dùng gửi email dự phòng, ví dụ `ten-cua-ban@gmail.com` |
| `GMAIL_APP_PASSWORD` | App Password Gmail dùng làm SMTP dự phòng |

Sau khi thêm biến, nhấn **Save Changes** để Render triển khai lại dịch vụ. Các biến tùy chọn khác vẫn có thể cấu hình như `GOOGLE_CLIENT_ID`, `DEMO_MODE`, `CLIENT_ORIGIN` và `PORT`. Máy chủ kiểm tra hạn nhiệm vụ khi khởi động và sau đó mỗi phút; khi còn dưới 24 giờ, nó gửi nhắc hạn tới Gmail của các thành viên được phân công và lưu `remindersSent` trong `store.json` để không gửi trùng.

Nếu chọn **Giờ báo lại cụ thể**, giao diện trình duyệt tự chuyển giờ địa phương thành ISO UTC trước khi gửi lên server, nên Render so sánh đúng thời điểm thực tế. Máy chủ quét mỗi phút và chỉ gửi trong vòng 30 phút kể từ giờ đã đặt. Nhật ký Logs ghi rõ lý do, thời điểm định gửi và chi tiết lỗi SMTP nếu Gmail từ chối email.

## 5. Các chức năng hiện có

- Bảng Kanban và danh sách, lọc trạng thái/ưu tiên, tìm kiếm và thống kê.
- Tạo nhiều workspace riêng, chuyển đổi giữa các workspace, mời thành viên theo email và tách dữ liệu bảng theo workspace.
- Tạo/chỉnh sửa nhiệm vụ, ba vai trò riêng biệt, chọn người kiểm tra thủ công hoặc random trong số thành viên còn lại.
- Đồng hồ đếm ngược từng giây, cảnh báo màu đỏ khi còn dưới 24 giờ hoặc quá hạn.
- Email thông báo khi giao nhiệm vụ và email nhắc hạn 24 giờ/1 giờ nếu đã cấu hình Gmail.
- Chi tiết nhiệm vụ có liên kết/tệp đính kèm (tối đa 15 MB), bình luận lưu bền và cập nhật trực tiếp qua Socket.IO.

## 6. Cấu hình và lưu trữ

Các biến môi trường có trong `.env.example`:

| Biến | Mặc định | Ý nghĩa |
|---|---|---|
| `PORT` | `4000` | Cổng API và ứng dụng production |
| `CLIENT_ORIGIN` | `http://localhost:5173` | Origin được phép kết nối khi phát triển |
| `DEMO_MODE` | `true` | Cho phép đăng nhập thử bằng email mà không xác minh Google; tắt để yêu cầu đăng nhập Google |
| `GOOGLE_CLIENT_ID` | *(trống)* | Google OAuth Client ID |
| `BREVO_API_KEY` | *(trống)* | Brevo HTTP API key gửi email; ưu tiên hơn SMTP |
| `GMAIL_USER` | *(trống)* | Gmail gửi email dự phòng |
| `GMAIL_APP_PASSWORD` | *(trống)* | App Password Gmail dùng SMTP dự phòng |
| `SMTP_PORT` | `587` | Cổng Gmail SMTP; dùng `465` để bật SMTPS hoặc `587` để dùng STARTTLS |

Dữ liệu workspace lưu trên máy, không có cơ sở dữ liệu cloud hay đồng bộ giữa nhiều máy chủ. Chế độ demo không xác minh danh tính email, chỉ nên dùng để thử nghiệm cục bộ. Khi triển khai công khai cho nhiều người dùng, cần thay kho JSON bằng cơ sở dữ liệu phù hợp, cấu hình HTTPS, sao lưu và bảo vệ tệp `.env`/thư mục uploads.
