# Hostel Hub - Premium Resident Management Portal

Hostel Hub is a modern, high-performance web application designed to manage hostel operations effortlessly. It provides absolute clarity and fluid control over resident management, room inventory, attendance, finances, and issue tracking.

## Features
- **Role-based Access Control**: Separate interfaces and capabilities for Master Admin and Residents.
- **Interactive Dashboard**: Real-time insights into bed occupancy, attendance, available vacancies, and recent system activity.
- **Room Management**: Add, track, and manage room inventory and capacities.
- **Resident Management**: Register students, allocate rooms, and maintain resident details.
- **Attendance Tracking**: Daily logs for resident presence.
- **Financial Module**: Manage fees and track resident payments.
- **Issue Log / Complaints**: Residents can file complaints, and the admin can track and resolve them.
- **Bulletin Board**: Broadcast notices and updates to all residents.
- **Offline-First with Auto-Sync**: Uses LokiJS for immediate client-side data handling, automatically syncing to a MySQL backend every 60 seconds.

## Tech Stack
- **Frontend**: Vanilla JavaScript, Vite, CSS
- **Local Data Storage**: LokiJS
- **Backend Server**: Node.js, Express
- **Database**: MySQL (via `mysql2`)

## Prerequisites
- [Node.js](https://nodejs.org/) (v16 or higher recommended)
- MySQL Server running locally or remotely

## Installation

1. **Clone or Download** the repository to your local machine.
2. **Install Dependencies**:
   Navigate to the project root and run:
   ```bash
   npm install
   ```
3. **Database Configuration**:
   Ensure your MySQL server is running. Create a `.env` file in the root directory (using `.env.example` if available) and configure your database credentials.

## Running the Application

To run the application for development, use:

```bash
# Start both the Vite dev server and the Express backend
npm run dev
npm run server
```

- The frontend will typically be accessible at `http://localhost:5173`.
- The API server runs at `http://localhost:5000`.

## Default Credentials

- **Admin Access**:
  - Username: `admin`
  - Password: `admin`

- **Demo Resident Access**:
  - Username: `user`
  - Password: `user`
  *(Or use a registered resident's email and their ID as the password)*