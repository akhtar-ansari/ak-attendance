# AK Attendance System v2.0

Biometric attendance system for warehouse operations with face recognition and geo-fencing.

## Features

- 👤 **Face Recognition** - Biometric attendance using face-api.js
- 📍 **Geo-fencing** - Location-based punch validation
- 🏛️ **Multi-Department** - Separate management per department
- 👥 **Role-Based Access** - Super Admin, Admin, Supervisor roles
- 📊 **Reports** - Daily, Monthly, and 3PL Billing reports
- 📸 **Photo Capture** - Punch photos with 30-day retention
- ✅ **LOP Management** - Leave approval workflow with bulk actions
- 📱 **Responsive** - Works on desktop, tablet, and mobile

## Tech Stack

- **Frontend**: HTML, CSS, JavaScript (Vanilla)
- **Database**: Supabase (PostgreSQL)
- **Storage**: Supabase Storage (punch photos)
- **Face Recognition**: face-api.js
- **Hosting**: GitHub Pages

## Attendance Rules

| Hours Worked | Status |
|--------------|--------|
| ≥ 10 hours | Present (P) |
| 4-10 hours | Half Day (H) |
| < 4 hours | Absent (A) |
| Friday | Paid Holiday |

## User Roles

| Role | Access |
|------|--------|
| Super Admin | All departments, all features |
| Admin | Own department only |
| Supervisor | Warehouse only, can request LOP |

## Project Structure
```
ak-attendance/
├── index.html              # Login page
├── dashboard.html          # Main dashboard
├── admin/                  # Admin pages
│   ├── departments.html
│   ├── users.html
│   └── settings.html
├── labor/                  # Labor management
│   ├── master.html
│   ├── enroll.html
│   └── import.html
├── attendance/             # Attendance features
│   ├── punch-locations.html
│   └── lop.html
├── reports/                # Reports
│   ├── daily.html
│   └── 3pl-billing.html
├── punch/                  # Punch terminal
│   └── index.html
├── js/
│   ├── config/
│   │   └── supabase.js
│   ├── auth/
│   │   └── auth.js
│   ├── api/
│   │   ├── department-api.js
│   │   ├── labor-api.js
│   │   ├── punch-api.js
│   │   ├── report-api.js
│   │   ├── lop-api.js
│   │   └── user-api.js
│   ├── utils/
│   │   ├── date-utils.js
│   │   ├── csv-handler.js
│   │   └── photo-utils.js
│   └── ui/
│       ├── sync-indicator.js
│       └── toast.js
├── css/
│   ├── main.css
│   ├── punch-terminal.css
│   └── reports.css
└── templates/
    └── labor-import-template.csv
```

## Setup Instructions

### 1. Supabase Setup

1. Create account at [supabase.com](https://supabase.com)
2. Create new project
3. Run SQL scripts to create tables (see documentation)
4. Create storage bucket `punch-photos` with public access
5. Copy Project URL and Anon Key

### 2. Configuration

Update `js/config/supabase.js` with your credentials:
```javascript
const SUPABASE_URL = 'your-project-url';
const SUPABASE_ANON_KEY = 'your-anon-key';
```

### 3. Deployment

1. Push code to GitHub repository
2. Enable GitHub Pages (Settings → Pages → Source: main branch)
3. Access at: `https://yourusername.github.io/ak-attendance/`

## Default Login

- **Username**: akhtar
- **Password**: AK@2026
- **Role**: Super Admin

## Quick Start

1. Login as Super Admin
2. Create Departments (Admin → Departments)
3. Create Users if needed (Admin → Users)
4. Add Punch Locations (Attendance → Punch Locations)
5. Add Laborers (Labor → Labor Master)
6. Enroll Faces (Labor → Master → Enroll button)
7. Open Punch Terminal for laborers to punch

## Browser Support

- Chrome (recommended)
- Firefox
- Safari
- Edge

## License

Private - M.A. Al Abdul Karim & Co

## Support

Contact: Akhtar Ansari