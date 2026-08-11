# DMS Student Activity - Complete Rebuild Strategy

**Project**: Rebuild DMS Frontend (Light theme + Role-based colors)  
**Base**: Old codebase analysis (React 18, Express, Docxtemplater)  
**Design**: Light theme with Admin (Blue), Student (Green), Adviser (Amber), STUACT (Purple)

---

## 📋 Overview

This document contains **5 phases** with complete, copy-paste-ready prompts for Claude/AI.

Each phase includes:
- **Objectives** - What gets built
- **Assumptions** - Defaults if not specified
- **The Prompt** - Use this verbatim with Claude
- **Expected Output** - What you should receive
- **Validation** - How to verify it works

---

## 🎯 Assumptions (Can override)

- **Database**: MySQL (keep existing)
- **State Mgmt**: Zustand (simpler than Redux)
- **Deployment**: Local dev first
- **Node Version**: 18+
- **Package Manager**: npm
- **Frontend Build**: Vite (faster than CRA)

---

# PHASE 1: Setup & Project Structure

**Duration**: 30 mins  
**Complexity**: ⭐ (Easy)

## Objectives

✅ Create folder structure  
✅ Generate package.json (frontend + backend)  
✅ Setup environment templates  
✅ Create README with quick-start  

---

## The Prompt (Copy entire block)

```
# PHASE 1: DMS Rebuild - Project Setup

You are building a complete Student Activity Management System from scratch, inspired by an old codebase but rebuilt modern.

## PROJECT INFO
- Name: DMS 2024 (Student Activity Management)
- Language: TypeScript + React 18
- Build: Vite
- State: Zustand
- Backend: Express + Node
- Design: Light theme, role-based colors (Admin: #1F40AF Blue, Student: #22C55E Green, Adviser: #F59E0B Amber, STUACT: #8B5CF6 Purple)

## TASK: Create complete project structure + config files

### 1. Frontend Folder Structure
```
dms-frontend/
├── public/
├── src/
│   ├── components/
│   │   ├── ui/                  (Button, Card, Badge, Input, Modal, etc)
│   │   ├── layout/              (Header, Sidebar, Footer)
│   │   └── features/            (ProjectList, ProjectDetail, Dashboard, etc)
│   ├── pages/                   (Role-based: /admin, /student, /adviser, /stuact)
│   ├── stores/                  (Zustand - auth, projects, budget, ui state)
│   ├── hooks/                   (useAuth, useProject, useBudget, etc)
│   ├── types/                   (TypeScript interfaces)
│   ├── utils/                   (helpers, formatters, API client)
│   ├── styles/                  (CSS variables, global styles)
│   ├── App.tsx
│   └── main.tsx
├── .env.example
├── .gitignore
├── package.json                 (with Vite, React 18, TailwindCSS, Zustand)
├── tsconfig.json
├── vite.config.ts
└── tailwind.config.js
```

### 2. Backend Folder Structure
```
dms-backend/
├── src/
│   ├── routes/
│   │   ├── admin.ts            (admin-only endpoints)
│   │   ├── student.ts          (student project endpoints + Word gen)
│   │   ├── adviser.ts          (review & approval endpoints)
│   │   ├── stuact.ts           (coordinator endpoints)
│   │   └── auth.ts             (login, token, refresh)
│   ├── middleware/
│   │   ├── verifyToken.ts
│   │   ├── errorHandler.ts
│   │   └── cors.ts
│   ├── controllers/
│   │   ├── projectController.ts
│   │   ├── budgetController.ts
│   │   ├── wordGenController.ts
│   │   └── authController.ts
│   ├── services/
│   │   ├── projectService.ts
│   │   ├── wordGenService.ts    (Docxtemplater logic)
│   │   └── authService.ts
│   ├── templates/
│   │   └── project-template.docx
│   ├── config/
│   │   ├── database.ts
│   │   └── env.ts
│   ├── types/
│   │   └── index.ts
│   ├── app.ts
│   └── server.ts
├── .env.example
├── .gitignore
├── package.json                (Express, TypeScript, Docxtemplater, MySQL2)
├── tsconfig.json
└── README.md
```

### 3. Create package.json files

**Frontend package.json:**
```json
{
  "name": "dms-frontend",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview",
    "lint": "eslint src",
    "type-check": "tsc --noEmit"
  },
  "dependencies": {
    "react": "^18.2.0",
    "react-dom": "^18.2.0",
    "react-router-dom": "^6.15.0",
    "zustand": "^4.4.0",
    "axios": "^1.6.7",
    "date-fns": "^2.30.0"
  },
  "devDependencies": {
    "@types/react": "^18.2.0",
    "@types/react-dom": "^18.2.0",
    "@vitejs/plugin-react": "^4.0.0",
    "vite": "^4.5.0",
    "typescript": "^5.2.0",
    "tailwindcss": "^3.3.0",
    "postcss": "^8.4.30",
    "autoprefixer": "^10.4.15"
  }
}
```

**Backend package.json:**
```json
{
  "name": "dms-backend",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "dev": "node --loader ts-node/esm src/server.ts",
    "build": "tsc",
    "start": "node dist/server.js",
    "lint": "eslint src"
  },
  "dependencies": {
    "express": "^4.18.0",
    "cors": "^2.8.5",
    "dotenv": "^16.3.1",
    "mysql2": "^3.6.0",
    "jsonwebtoken": "^9.1.0",
    "bcryptjs": "^2.4.3",
    "docxtemplater": "^3.42.0",
    "pizzip": "^3.2.0",
    "axios": "^1.6.7"
  },
  "devDependencies": {
    "@types/express": "^4.17.21",
    "@types/node": "^20.8.0",
    "typescript": "^5.2.0",
    "ts-node": "^10.9.1"
  }
}
```

### 4. Environment Templates

**.env.example (Frontend):**
```
VITE_API_URL=http://localhost:3000/api
VITE_APP_NAME=DMS 2024
VITE_THEME=light
```

**.env.example (Backend):**
```
PORT=3000
NODE_ENV=development
DB_HOST=localhost
DB_USER=root
DB_PASSWORD=your_password
DB_NAME=dms_db
JWT_SECRET=your_jwt_secret_key_here
JWT_EXPIRY=7d
```

### 5. README Template

Create both frontend/README.md and backend/README.md with:
- Quick start (npm install → npm run dev)
- Environment setup
- API endpoints list
- Project structure explanation
- Troubleshooting

## DELIVERABLES

Generate:
1. ✅ Complete folder structure commands (mkdir -p ...)
2. ✅ All config files (tsconfig.json, vite.config.ts, tailwind.config.js)
3. ✅ Complete package.json for frontend + backend
4. ✅ .env.example files
5. ✅ README.md with quick start guide
6. ✅ .gitignore files
7. ✅ Create a setup-guide.md with step-by-step local setup

## OUTPUT FORMAT

Provide:
- Code blocks for each file (clearly labeled)
- Setup commands to run in order
- Validation checklist (how to verify setup worked)
- Next phase pointer (Phase 2 preview)
```

---

## Expected Output

Claude will generate:
- ✅ All folder structures
- ✅ Complete config files
- ✅ package.json (both frontend & backend)
- ✅ Environment templates
- ✅ README with quick-start
- ✅ Setup commands to copy-paste

---

## Validation Checklist

After Phase 1, run these:

```bash
# 1. Frontend setup
cd dms-frontend
npm install
npm run build        # Should succeed
npm run dev          # Should start Vite server on 5173

# 2. Backend setup
cd ../dms-backend
npm install
npm run build        # Should compile TS → JS

# 3. Environment check
ls -la .env.example  # Both folders should have this
```

✅ **Phase 1 Complete when**: Both folders have dependencies installed and configs validated.

---

# PHASE 2: React Component Library

**Duration**: 1.5 hours  
**Complexity**: ⭐⭐ (Medium)

## Objectives

✅ Create reusable UI components  
✅ Setup TailwindCSS with role colors  
✅ Create layout components (Header, Sidebar, Footer)  
✅ Setup routing structure  
✅ Create Zustand stores  

---

## The Prompt (Copy entire block)

```
# PHASE 2: DMS Rebuild - React Component Library

You are building the frontend component library and state management for the DMS project.

## CONTEXT
- Design: Light theme with role colors (Admin: #1F40AF, Student: #22C55E, Adviser: #F59E0B, STUACT: #8B5CF6)
- State: Zustand
- Styling: TailwindCSS
- Router: React Router v6

## TASK 1: Create TailwindCSS Config with Role Colors

Generate tailwind.config.js that:
- Extends with role color palette (admin-blue, student-green, adviser-amber, stuact-purple)
- Adds each color in 50-900 shades
- Exports CSS variables for light theme
- Includes custom utilities for role badges, buttons

Example color usage:
```
bg-admin-600 text-white  (Admin button)
bg-student-500 text-white (Student button)
border-adviser-400 (Adviser accent)
```

## TASK 2: Create UI Component Library

Generate React components in src/components/ui/:

### Required components:

**Button.tsx**
- Variants: primary, secondary, danger, ghost
- Sizes: sm, md, lg
- Role-aware coloring (admin/student/adviser/stuact)
- Props: onClick, disabled, loading, icon, fullWidth

**Card.tsx**
- Default surface styling (light background)
- Variants: elevated (shadow), flat (border)
- Props: title, subtitle, children, padding, borderColor

**Badge.tsx**
- For status display (Approved, Draft, In Review, Executing)
- Colors tied to role colors
- Icon support

**Input.tsx** (text, email, number)
- Label + helper text
- Role-focused (blue border on focus)
- Error state
- Accessible labels

**Select.tsx**
- Dropdown component
- Option groups
- Searchable variant
- Clear button

**Modal.tsx**
- Header, body, footer slots
- Close button
- Role-colored header accent
- Backdrop blur

**Tabs.tsx**
- Tab navigation with underline
- Active tab highlighted in role color
- Content panels

**ProgressBar.tsx**
- Linear progress bar
- Percentage display
- Color: student green (matches old project)

**Avatar.tsx**
- Initials circle
- Role-colored background
- Size variants

**Toast/Alert.tsx**
- Success, warning, danger, info variants
- Auto-dismiss option
- Role-aware colors

## TASK 3: Create Layout Components

Generate in src/components/layout/:

**Header.tsx**
- Logo + app name "DMS 2024"
- Search bar (placeholder: "Search projects...")
- Profile dropdown (role indicator)
- Mobile menu toggle

**Sidebar.tsx**
- Role-specific navigation (Admin vs Student vs Adviser vs STUACT)
- Collapsible on mobile
- Menu items with role colors
- Active state highlighting

**Footer.tsx**
- Copyright
- Links
- Year

**MainLayout.tsx**
- Combines Header + Sidebar + Footer
- Children wrapper
- Responsive (sidebar hidden on mobile)

## TASK 4: Setup Zustand Stores

Generate in src/stores/:

**authStore.ts**
- State: user, isLogged, role, token
- Actions: login, logout, setUser, refreshToken
- Persist to localStorage

**projectStore.ts**
- State: projects[], currentProject, filters
- Actions: fetchProjects, createProject, updateProject, deleteProject
- Loading/error states

**budgetStore.ts**
- State: budgets[], totalBudget, spent
- Actions: fetchBudgets, addBudget, updateBudget

**uiStore.ts**
- State: sidebarOpen, theme (light/dark), role
- Actions: toggleSidebar, setTheme, setRole

## TASK 5: Setup React Router

Generate src/App.tsx with:
- Route structure (guest, admin, student, adviser, stuact layouts)
- Protected routes
- Redirect logic
- 404 fallback

Structure:
```
/
├── /guest/login
├── /admin/* (admin-only)
├── /student/* (student-only)
├── /adviser/* (adviser-only)
└── /stuact/* (stuact-only)
```

## DELIVERABLES

1. ✅ Complete UI components (Button, Card, Badge, Input, Select, Modal, Tabs, etc)
2. ✅ Layout components (Header, Sidebar, Footer, MainLayout)
3. ✅ Zustand stores (auth, project, budget, ui)
4. ✅ Router config (App.tsx)
5. ✅ TailwindCSS config with role colors
6. ✅ Type definitions (types/index.ts)
7. ✅ Example usage for each component

## OUTPUT FORMAT

Provide each component as:
- ✅ Complete TSX file
- ✅ Props interface
- ✅ Example usage
- ✅ Dark mode consideration (if applicable)

Note: Use TypeScript throughout. No JavaScript files.
```

---

## Expected Output

Claude will generate:
- ✅ All UI components (Button, Card, Badge, Input, Select, Modal, Tabs, etc.)
- ✅ Layout components (Header, Sidebar, Footer)
- ✅ Zustand stores (authStore, projectStore, budgetStore, uiStore)
- ✅ React Router setup
- ✅ TailwindCSS config with role colors
- ✅ Type definitions

---

## Validation Checklist

After Phase 2:

```bash
cd dms-frontend
npm install tailwindcss postcss autoprefixer
npm run dev

# In browser: http://localhost:5173
# Should show: Basic layout with sidebar, header, footer
# No errors in console
```

---

# PHASE 3: Backend Routes & API

**Duration**: 1.5 hours  
**Complexity**: ⭐⭐ (Medium-Hard)

## Objectives

✅ Refactor Express routes (admin, student, adviser, stuact)  
✅ Create controllers for business logic  
✅ Setup database connection  
✅ Create API endpoints (CRUD projects, budgets, users)  
✅ Implement JWT authentication  

---

## The Prompt

```
# PHASE 3: DMS Rebuild - Backend Routes & API

You are building the Express backend for DMS with role-based endpoints.

## REFERENCE
Old codebase analysis:
- adminRoutes.js (64KB)
- studentRoutes.js (101KB) - Contains Word generation logic
- stuactRoutes.js (819 bytes)
- Pattern: Express router with MySQL queries, Docxtemplater in studentRoutes

## TASK: Create complete backend with routes, controllers, services

### 1. Database Connection (config/database.ts)

Generate:
- MySQL connection pool using mysql2
- Singleton pattern
- Connection error handling
- Query helper functions

### 2. Authentication Routes (routes/auth.ts)

Endpoints:
- POST /api/auth/login (email, password) → token + user role
- POST /api/auth/refresh (refresh_token) → new token
- POST /api/auth/logout
- GET /api/auth/me (verify token) → user info

### 3. Admin Routes (routes/admin.ts)

Endpoints:
- GET /api/admin/projects (all projects)
- GET /api/admin/projects/:id
- POST /api/admin/projects (create)
- PUT /api/admin/projects/:id (update)
- DELETE /api/admin/projects/:id
- GET /api/admin/budget (all budgets)
- POST /api/admin/budget (add)
- GET /api/admin/users (list all users)
- GET /api/admin/reports (export stats)

### 4. Student Routes (routes/student.ts)

Endpoints:
- GET /api/student/projects (my projects)
- POST /api/student/projects (create new)
- PUT /api/student/projects/:id (edit)
- GET /api/student/projects/:id (details)
- POST /api/student/projects/:id/submit (submit for review)
- POST /api/student/projects/:id/generate-doc (DOCXTEMPLATER CALL)
- GET /api/student/projects/:id/document/:docId (download)
- GET /api/student/budget/:projectId
- POST /api/student/budget/:projectId (add budget line)

### 5. Adviser Routes (routes/adviser.ts)

Endpoints:
- GET /api/adviser/review-queue (pending reviews)
- GET /api/adviser/review-queue/:id (review details)
- POST /api/adviser/review-queue/:id/approve (approve + feedback)
- POST /api/adviser/review-queue/:id/reject (reject + feedback)
- GET /api/adviser/projects (all assigned projects)

### 6. STUACT Routes (routes/stuact.ts)

Endpoints:
- GET /api/stuact/dashboard (overview stats)
- GET /api/stuact/projects (all projects filter by year/status)
- GET /api/stuact/budget-summary (total budget usage)
- GET /api/stuact/reports (generate reports)
- POST /api/stuact/export (export to Excel)

### 7. Controllers (src/controllers/)

Create:
- projectController.ts (createProject, getProjects, updateProject, deleteProject)
- budgetController.ts (manageBudget)
- wordGenController.ts (generateDocument - CALLS wordGenService)
- authController.ts (login, logout, refresh)

### 8. Services (src/services/)

Create:
- projectService.ts (DB queries, business logic)
- budgetService.ts
- wordGenService.ts (Docxtemplater integration - SEE PHASE 4)
- authService.ts (JWT token generation, password hashing)

### 9. Middleware

Create:
- verifyToken.ts (JWT validation, extract role)
- errorHandler.ts (centralized error response)
- cors.ts (CORS configuration)

### 10. Main App File (src/app.ts)

Setup:
- Express initialization
- Middleware (cors, bodyParser, errorHandler)
- Routes mounting
- 404 handler

## REFERENCE DATA STRUCTURES

Based on old codebase:

**Project Table:**
```
id, project_name, description, responsible_agency, location, 
start_date, end_date, status, budget, created_by, created_at, updated_at
```

**Budget Table:**
```
id, project_id, category, amount, spent, approved_by, created_at
```

**User Table:**
```
id, email, password_hash, account_type (admin/student/adviser/stuact), 
club_code, name, created_at
```

## DELIVERABLES

1. ✅ Database connection setup
2. ✅ Authentication service (JWT + bcrypt)
3. ✅ All routes (admin, student, adviser, stuact)
4. ✅ All controllers
5. ✅ All services
6. ✅ Middleware (auth, error, cors)
7. ✅ Type definitions (request/response interfaces)
8. ✅ app.ts setup
9. ✅ server.ts entry point

## IMPORTANT

- Reference old project logic but structure cleanly
- Separate business logic to services
- Use TypeScript throughout
- Add try-catch in controllers
- Return consistent JSON format: { success, data, error, message }
- For Word generation endpoints, leave a TODO comment - will be implemented in Phase 4
```

---

## Expected Output

Claude will generate:
- ✅ All route files
- ✅ All controllers
- ✅ All services (with TODO for Word gen)
- ✅ Database setup
- ✅ Middleware
- ✅ Type definitions

---

# PHASE 4: Docxtemplater Integration

**Duration**: 45 mins  
**Complexity**: ⭐⭐ (Medium)

## Objectives

✅ Analyze old Word template  
✅ Create wordGenService with Docxtemplater  
✅ Implement document generation endpoints  
✅ Setup download functionality  

---

## The Prompt

```
# PHASE 4: DMS Rebuild - Docxtemplater Integration

You are implementing Word document generation for DMS project reports.

## REFERENCE
Old implementation (from studentRoutes.js ~line 1174):
```
const PizZip = require("pizzip");
const Docxtemplater = require("docxtemplater");
const zip = new PizZip(content);
const doc = new Docxtemplater(zip, {
  parser: expressionParser,
  paragraphLoop: true,
  linebreaks: true,
});
doc.render({
  detail: result[0],
  person: resultp_person[0],
  timestep: resultp_timestep[0],
  indicator: resultp_indicator[0],
  budget: resultp_budget[0],
  user: resultuser[0],
  userSH: resultuserSH[0],
});
const buf = doc.getZip().generate({ type: "nodebuffer", compression: "DEFLATE" });
```

## TASK: Create wordGenService

### 1. Template Structure

Create template.docx with placeholders for:
```
{detail.project_name}
{detail.description}
{detail.location}
{detail.start_date} - {detail.end_date}
{user.name} | {user.email}
{person.list[*]} (loop through personnel)
{budget.items[*]} (loop through budget)
{timestep.items[*]} (loop through timeline)
{indicator.items[*]} (loop through indicators)
```

### 2. Service File (services/wordGenService.ts)

Generate:
- Function: generateDocument(projectId, projectData) → Buffer
- Function: saveDocumentToDisk(buffer, filename) → filepath
- Error handling for template not found
- Validation of data structure
- Support for multiple template versions (temp04.docx, temp06.docx)

### 3. Controller Update (controllers/wordGenController.ts)

Endpoints:
- POST /api/student/projects/:id/generate-doc
  - Fetch project data from DB
  - Call wordGenService
  - Return download link or stream buffer
  
- GET /api/student/projects/:id/download/:docId
  - Verify user owns document
  - Stream file to client

### 4. Data Assembly

Create function to gather all project data:
```
{
  detail: { project_name, description, location, dates, budget },
  person: [ { name, role, email }, ... ],
  timestep: [ { step, date, status }, ... ],
  budget: [ { category, amount, spent }, ... ],
  indicator: [ { name, target, actual }, ... ],
  user: { name, email, role }
}
```

## IMPLEMENTATION NOTES

- Use async/await for file operations
- Stream large buffers instead of loading to memory
- Cache templates in memory (don't reload each request)
- Validate data before rendering to catch template errors
- Log errors clearly (template syntax issues)

## DELIVERABLES

1. ✅ wordGenService.ts with generateDocument()
2. ✅ wordGenController.ts with POST generate and GET download
3. ✅ Database query to gather project data
4. ✅ Template file (copy/create template.docx)
5. ✅ Error handling for common template issues
6. ✅ Unit test examples

## DATA FLOW

User clicks "Export to Word" 
  → POST /api/student/projects/:id/generate-doc
  → Controller fetches project + all related data
  → wordGenService.generateDocument(data)
  → Docxtemplater renders
  → Buffer returned
  → Save to disk OR stream to client
  → Client downloads file
```

---

## Expected Output

Claude will generate:
- ✅ wordGenService.ts (complete)
- ✅ wordGenController.ts (complete)
- ✅ Data assembly function
- ✅ Template placeholder guide
- ✅ Error handling examples

---

# PHASE 5: Integration & Testing

**Duration**: 1 hour  
**Complexity**: ⭐⭐⭐ (Hard)

## Objectives

✅ Connect frontend to backend API  
✅ Test all role-based flows  
✅ Verify Word generation  
✅ Create demo data  
✅ Document API  

---

## The Prompt

```
# PHASE 5: DMS Rebuild - Full Integration & Testing

You are doing final integration between frontend and backend.

## TASK 1: API Client Setup

Create src/utils/api.ts:
- Axios instance with BASE_URL
- Request interceptor (attach JWT token)
- Response interceptor (handle 401, refresh token)
- Typed responses
- Error handling

## TASK 2: Connect Zustand to API

Update stores:
- authStore: call /auth/login, /auth/logout
- projectStore: call /projects endpoints
- budgetStore: call /budget endpoints
- Show loading states

## TASK 3: Test Matrix

Create test scenarios:

**Admin Flow:**
- Login as admin
- View dashboard (all projects, stats)
- Create project
- Approve student submission

**Student Flow:**
- Login as student
- Create project (form filled)
- Submit for review
- Generate Word document
- Download document

**Adviser Flow:**
- Login as adviser
- View review queue
- Approve/reject project
- Add feedback

**STUACT Flow:**
- Login as stuact
- View all projects
- View budget overview
- Export report

## TASK 4: Demo Data

Generate SQL to insert:
- 4 test users (admin, student, adviser, stuact)
- 5 sample projects (various statuses)
- Budget data
- Timeline data

## TASK 5: Documentation

Create:
- API documentation (all endpoints)
- Setup guide (local dev)
- Troubleshooting common issues
- Deployment checklist

## DELIVERABLES

1. ✅ API client (axios config)
2. ✅ Zustand store API calls
3. ✅ Test scenarios (manual testing list)
4. ✅ Demo data SQL
5. ✅ API docs (markdown)
6. ✅ Setup guide
```

---

## Expected Output

Claude will generate:
- ✅ API client setup
- ✅ Updated stores
- ✅ Test scenarios
- ✅ Demo data SQL
- ✅ Documentation

---

## 🚀 How to Use This Strategy

**For Each Phase:**

1. Copy the prompt from the section above
2. Paste into Claude chat
3. Request file by file if output is too large
4. Save outputs to correct folders
5. Run validation checklist
6. Move to next phase

**Timeline:**
- Phase 1: 30 mins (setup)
- Phase 2: 1.5 hrs (components)
- Phase 3: 1.5 hrs (backend)
- Phase 4: 45 mins (Word gen)
- Phase 5: 1 hr (integration)

**Total: ~6 hours of work**

---

## ⚠️ If Something Goes Wrong

**Problem**: Components won't compile  
**Solution**: Check TypeScript errors → Ask Claude to fix types

**Problem**: API calls 404  
**Solution**: Verify backend running on :3000 → Check route paths

**Problem**: Word generation fails  
**Solution**: Validate template placeholders → Check data structure

---

## 📞 Questions?

Each phase has a validation section. Follow it step-by-step.

**Next**: Pick Phase 1 above, copy the prompt, and send to Claude! 🎯