-- PostgreSQL Initial Schema Migration for HostelFix
-- Database: HostelFix

-- Enable UUID extension if available
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. USERS TABLE
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    "userId" VARCHAR(100) UNIQUE NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,
    name VARCHAR(255) NOT NULL,
    role VARCHAR(50) NOT NULL DEFAULT 'student',
    status VARCHAR(50) DEFAULT 'Active',
    phone VARCHAR(50),
    "hostelBlock" VARCHAR(100),
    "roomNumber" VARCHAR(50),
    "registrationNumber" VARCHAR(100),
    "createdByAdmin" BOOLEAN DEFAULT FALSE,
    "created_at" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 2. STUDENTS TABLE
CREATE TABLE IF NOT EXISTS students (
    id SERIAL PRIMARY KEY,
    "userId" VARCHAR(100) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) NOT NULL,
    "registrationNumber" VARCHAR(100),
    "hostelBlock" VARCHAR(100),
    "roomNumber" VARCHAR(50),
    phone VARCHAR(50),
    "wardenId" VARCHAR(100),
    "wardenName" VARCHAR(255),
    "wardenEmail" VARCHAR(255),
    "created_at" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 3. WARDENS TABLE
CREATE TABLE IF NOT EXISTS wardens (
    id SERIAL PRIMARY KEY,
    "userId" VARCHAR(100) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) NOT NULL,
    phone VARCHAR(50),
    "hostelBlock" VARCHAR(100),
    "assignedBlocks" JSONB DEFAULT '[]',
    "created_at" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 4. WARDEN SCOPES TABLE
CREATE TABLE IF NOT EXISTS warden_scopes (
    id SERIAL PRIMARY KEY,
    "wardenId" VARCHAR(100) NOT NULL,
    "hostelBlock" VARCHAR(100) NOT NULL,
    "assignedAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 5. WARDEN PERMISSIONS TABLE
CREATE TABLE IF NOT EXISTS warden_permissions (
    id SERIAL PRIMARY KEY,
    "wardenId" VARCHAR(100) UNIQUE NOT NULL,
    "canApproveComplaints" BOOLEAN DEFAULT TRUE,
    "canIssuePasses" BOOLEAN DEFAULT TRUE,
    "canManageInventory" BOOLEAN DEFAULT TRUE,
    "canManageStudents" BOOLEAN DEFAULT TRUE,
    "updatedAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 6. COMPLAINTS TABLE
CREATE TABLE IF NOT EXISTS complaints (
    id VARCHAR(100) PRIMARY KEY,
    student VARCHAR(255) NOT NULL,
    email VARCHAR(255) NOT NULL,
    "registrationNumber" VARCHAR(100),
    "hostelBlock" VARCHAR(100),
    "roomNumber" VARCHAR(50),
    category VARCHAR(100) NOT NULL,
    priority VARCHAR(50) DEFAULT 'Low',
    description TEXT,
    status VARCHAR(50) DEFAULT 'Pending',
    "assignedTo" VARCHAR(255),
    "resolutionNotes" TEXT,
    "beforePhotoUrl" TEXT,
    "afterPhotoUrl" TEXT,
    timeline JSONB DEFAULT '[]',
    "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 7. GATE PASSES TABLE
CREATE TABLE IF NOT EXISTS gate_passes (
    id VARCHAR(100) PRIMARY KEY,
    student VARCHAR(255) NOT NULL,
    email VARCHAR(255) NOT NULL,
    "registrationNumber" VARCHAR(100),
    "hostelBlock" VARCHAR(100),
    "roomNumber" VARCHAR(50),
    "gateDate" VARCHAR(100),
    "returnDate" VARCHAR(100),
    session VARCHAR(50),
    reason TEXT,
    status VARCHAR(50) DEFAULT 'Pending',
    "exitTime" VARCHAR(100),
    "hostelArrivalTime" VARCHAR(100),
    "approvedBy" VARCHAR(255),
    "qrCode" TEXT,
    "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 8. LAUNDRY REQUESTS TABLE
CREATE TABLE IF NOT EXISTS laundry_requests (
    id VARCHAR(100) PRIMARY KEY,
    "studentName" VARCHAR(255) NOT NULL,
    email VARCHAR(255) NOT NULL,
    "hostelBlock" VARCHAR(100),
    "roomNumber" VARCHAR(50),
    "clothCount" INT DEFAULT 0,
    "pickupDate" VARCHAR(100),
    status VARCHAR(50) DEFAULT 'Requested',
    "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 9. ANNOUNCEMENTS TABLE
CREATE TABLE IF NOT EXISTS announcements (
    id VARCHAR(100) PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    audience VARCHAR(100) DEFAULT 'All',
    priority VARCHAR(50) DEFAULT 'Normal',
    "authorName" VARCHAR(255),
    "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 10. INVENTORY TABLE
CREATE TABLE IF NOT EXISTS inventory (
    id VARCHAR(100) PRIMARY KEY,
    item_name VARCHAR(255) NOT NULL,
    category VARCHAR(100),
    quantity INT DEFAULT 0,
    min_threshold INT DEFAULT 5,
    unit VARCHAR(50) DEFAULT 'pcs',
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 11. PERSONAL NOTIFICATIONS TABLE
CREATE TABLE IF NOT EXISTS personal_notifications (
    id VARCHAR(100) PRIMARY KEY,
    type VARCHAR(100),
    title VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    audience VARCHAR(100),
    "targetEmail" VARCHAR(255),
    "targetName" VARCHAR(255),
    priority VARCHAR(50) DEFAULT 'Normal',
    read BOOLEAN DEFAULT FALSE,
    "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 12. SECURITY EVENTS TABLE
CREATE TABLE IF NOT EXISTS security_events (
    id VARCHAR(100) PRIMARY KEY,
    event_type VARCHAR(100) NOT NULL,
    description TEXT,
    location VARCHAR(255),
    severity VARCHAR(50) DEFAULT 'Info',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- INDEXES FOR FAST PERFORMANCE
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_complaints_status ON complaints(status);
CREATE INDEX IF NOT EXISTS idx_complaints_email ON complaints(email);
CREATE INDEX IF NOT EXISTS idx_gate_passes_email ON gate_passes(email);
CREATE INDEX IF NOT EXISTS idx_gate_passes_status ON gate_passes(status);
