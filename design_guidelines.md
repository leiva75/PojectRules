# Design Guidelines: Cronos Fichajes - Sistema de Control Horario

## Design Approach

**Selected System:** Material Design 3 with enterprise adaptations
**Rationale:** Material Design provides robust patterns for data-rich applications, excellent mobile support for employee PWA, and clear component hierarchy essential for multi-role time-tracking systems.

**Core Principles:**
- Functional clarity over decorative elements
- Role-specific interface optimization
- Touch-friendly interactions for kiosk/mobile
- Information density balanced with breathing room

---

## Typography System

**Font Family:** 
- Primary: Roboto (via Google Fonts)
- Monospace: Roboto Mono (for timestamps, employee IDs)

**Type Scale:**
- Display (Role Headers): 32px/2rem, Semi-bold
- H1 (Page Titles): 24px/1.5rem, Medium  
- H2 (Section Headers): 20px/1.25rem, Medium
- H3 (Card Titles): 18px/1.125rem, Medium
- Body Large (Primary Text): 16px/1rem, Regular
- Body (Secondary Text): 14px/0.875rem, Regular
- Caption (Meta Info): 12px/0.75rem, Regular

**Line Heights:**
- Headers: 1.2
- Body: 1.5
- Captions: 1.4

---

## Layout System

**Spacing Primitives:** Use Tailwind units of **2, 4, 6, 8, 12, 16**
- Micro spacing (inside cards): p-4, gap-2
- Component spacing: p-6, gap-4  
- Section spacing: p-8, gap-6
- Page margins: p-12 desktop, p-6 mobile

**Grid System:**
- Admin Dashboard: 12-column grid with 3-4 card layout
- Mobile/Kiosk: Single column, full-width cards
- Tables: Full-width with horizontal scroll on mobile

**Responsive Breakpoints:**
- Mobile: < 768px (default, single column)
- Tablet: 768px - 1024px (2 columns)
- Desktop: > 1024px (3-4 columns)

---

## Component Library

### Navigation
**Admin/Manager Desktop:**
- Persistent left sidebar (240px width) with role-based menu items
- Top app bar with user profile, notifications, logout
- Breadcrumb navigation for deep pages

**Employee Mobile/Kiosk:**
- Bottom navigation bar (60px height) with 3-4 primary actions
- Minimal top bar with time display and menu icon
- Full-screen punch interface

### Forms & Inputs
**Login Forms:**
- Centered card (max-width: 400px) on solid background
- Large input fields (h-12) with floating labels
- Primary action button (full-width)

**Punch Interface (Kiosk/Mobile):**
- Large central punch button (160px diameter, circular)
- Employee badge/photo display (96px)
- Current status indicator (IN/OUT) with timestamp
- Geolocation status badge

**Admin Forms:**
- Standard Material text fields with labels
- Date/time pickers for corrections
- Validation messages below inputs

### Data Display
**Punch History Tables:**
- Sticky header with sortable columns
- Alternating row background for readability
- Status badges (IN: green, OUT: orange, NEEDS_REVIEW: red)
- Timestamp in monospace font
- Actions column (view, export) on right

**Dashboard Cards:**
- Elevated cards (shadow-md) with 16px padding
- Header with icon + title
- Primary metric (large, 32px)
- Secondary stats in grid below
- Subtle dividers between sections

**Employee Cards:**
- Horizontal layout: Avatar (64px) | Name/Role | Status | Actions
- Badge indicators for active/inactive status

### Buttons & Actions
**Primary Actions:** 
- Filled buttons (h-10, px-6, rounded-lg)
- "Punch In" uses large variant (h-16, text-xl)

**Secondary Actions:**
- Outlined buttons (same dimensions)

**Icon Buttons:**
- 40px touch targets for mobile
- Export, edit, delete actions

**Kiosk Punch Button:**
- Circular, 160px diameter
- Elevated shadow (shadow-2xl)
- Pulsing animation when active session

### Overlays & Modals
**Correction Dialog:**
- Center modal (max-w-md)
- Clear title explaining append-only nature
- Form fields with validation
- Action buttons (Cancel/Submit) aligned right

**Export Modal:**
- Date range picker
- Employee multi-select dropdown
- Format selection (CSV only for MVP)
- Download button

---

## Interface-Specific Layouts

### Admin Dashboard
- 3-column grid: Today's Stats | Recent Punches | Flagged Items
- Full-width employee table below
- Floating action button for "Add Employee"

### Manager View
- 2-column: Team Summary | Individual Breakdown
- Filter bar (date range, employee, status)
- Export button in top-right

### Employee Mobile
- Hero section: Employee name, current status, last punch time
- Large central punch button
- History timeline below (recent 10 punches)
- Bottom nav: Home | History | Profile

### Kiosk Mode
- Minimal UI: Company logo + current time at top
- Central employee selector (badge scan or PIN entry)
- After selection: Large punch button + employee photo
- Auto-logout after 30 seconds

---

## Data Visualization

**Status Indicators:**
- Chips/badges with icons
- Green (success): Active, Punched In
- Orange (warning): Needs Review, Missing Location
- Red (error): Blocked Action, Violation
- Gray (neutral): Punched Out, Inactive

**Timestamps:**
- Relative time for recent (e.g., "2 hours ago")
- Full format for historical (e.g., "Jan 15, 2024 14:30")
- Consistent format across all interfaces

---

## Accessibility & Mobile

**Touch Targets:** Minimum 44px for all interactive elements
**Form Labels:** Always visible, not placeholder-only
**Focus States:** 2px outline on keyboard navigation
**Screen Reader:** Semantic HTML with ARIA labels for status badges
**Offline Indicator:** Persistent banner when PWA is offline

---

## Images

**Placement:**
- Employee avatars throughout (64px standard, 96px on punch screen)
- Company logo in kiosk header (120px height)
- Empty states: Illustrations for "No punches today" (240px)

No large hero images - this is a functional tool prioritizing data and actions over marketing visuals.