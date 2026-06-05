# วิธีเปิดใช้งาน ERP-POS

## ความต้องการ
- Docker Desktop (ต้องเปิดไว้ก่อน)
- macOS

## วิธีเปิดระบบ
### วิธีที่ 1: ดับเบิ้ลคลิก
ดับเบิ้ลคลิกที่ไฟล์ `start.command` ใน Finder

### วิธีที่ 2: Terminal
```bash
cd '/Users/macbook/Library/CloudStorage/.../erp-pos'
./start.sh
```

## เข้าใช้งาน
- เปิด Browser: http://localhost
- Username: `admin`
- Password: `Admin1234!`
- Company ID: `9790f996-1078-4634-9876-c5a828cbb263`

## ปิดระบบ
### วิธีที่ 1: ดับเบิ้ลคลิก
ดับเบิ้ลคลิกที่ไฟล์ `stop.command` ใน Finder

### วิธีที่ 2: Terminal
```bash
./stop.sh
```
หรือเปิด Docker Desktop แล้วกด Stop All

## หมายเหตุ
- ครั้งแรกใช้เวลา build ~5-10 นาที
- ครั้งต่อไปเร็วขึ้น ~1-2 นาที
- ข้อมูลถูกเก็บใน Docker volume (ไม่หายเมื่อ stop)
