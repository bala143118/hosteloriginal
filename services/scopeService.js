/**
 * Warden Scope Service
 * Dynamically resolves and matches student, complaint, and gatepass records
 * against a warden's configured control scope.
 */

function normalizeString(str) {
    return String(str || '').trim().toLowerCase();
}

function normalizeBlock(block) {
    const raw = normalizeString(block).replace(/\s+/g, '');
    if (raw === 'all' || !raw) return 'all';
    // Match "blocka" -> "a", "block-a" -> "a"
    return raw.replace(/^block-?/, '');
}

function extractFloorFromRoom(room) {
    if (!room) return null;
    const digits = String(room).replace(/\D/g, '');
    if (digits.length >= 3) {
        // e.g. 101 -> 1, 204 -> 2, 1102 -> 11
        return digits.slice(0, -2);
    }
    return digits || null;
}

function isRoomInRange(room, roomRangePattern) {
    if (!room || !roomRangePattern || normalizeString(roomRangePattern) === 'all') return true;

    const normRoom = normalizeString(room);
    const pattern = normalizeString(roomRangePattern);

    // List separated by commas: e.g. "101, 102, 103" or "101-130, 201-230"
    if (pattern.includes(',')) {
        const parts = pattern.split(',').map(p => p.trim());
        return parts.some(p => isRoomInRange(room, p));
    }

    // Range: e.g. "101-130" or "A101-A130"
    if (pattern.includes('-')) {
        const [startStr, endStr] = pattern.split('-').map(p => p.trim());
        const startNum = parseInt(startStr.replace(/\D/g, ''), 10);
        const endNum = parseInt(endStr.replace(/\D/g, ''), 10);
        const roomNum = parseInt(normRoom.replace(/\D/g, ''), 10);

        if (!isNaN(startNum) && !isNaN(endNum) && !isNaN(roomNum)) {
            return roomNum >= startNum && roomNum <= endNum;
        }
    }

    return normRoom === pattern || normRoom.includes(pattern) || normRoom.endsWith(pattern);
}

function isFloorAllowed(studentFloor, studentRoom, allowedFloors) {
    if (!allowedFloors || normalizeString(allowedFloors) === 'all') return true;

    const floorsList = String(allowedFloors).split(',').map(f => f.trim().toLowerCase());
    const floor = studentFloor ? String(studentFloor).trim().toLowerCase() : extractFloorFromRoom(studentRoom);

    if (!floor) return true; // If student has no floor info, allow based on block
    return floorsList.includes(floor);
}

function isStudentInScope(student, scope) {
    if (!scope || !scope.isActive) return false;
    if (scope.hostel === 'All' && scope.block === 'All' && scope.floors === 'All' && scope.rooms === 'All') {
        return true;
    }

    // 1. Hostel Match
    if (scope.hostel && normalizeString(scope.hostel) !== 'all') {
        if (student.hostel && normalizeString(student.hostel) !== 'all') {
            if (normalizeString(student.hostel) !== normalizeString(scope.hostel) && !normalizeString(student.hostel).includes(normalizeString(scope.hostel))) {
                return false;
            }
        }
    }

    // 2. Block Match
    if (scope.block && normalizeString(scope.block) !== 'all') {
        const studentBlock = normalizeBlock(student.block || student.hostelBlock);
        const scopeBlock = normalizeBlock(scope.block);
        if (studentBlock !== 'all' && studentBlock !== scopeBlock) {
            return false;
        }
    }

    // 3. Floor Match
    if (scope.floors && normalizeString(scope.floors) !== 'all') {
        if (!isFloorAllowed(student.floor, student.roomNumber || student.room, scope.floors)) {
            return false;
        }
    }

    // 4. Room Match
    if (scope.rooms && normalizeString(scope.rooms) !== 'all') {
        if (!isRoomInRange(student.roomNumber || student.room, scope.rooms)) {
            return false;
        }
    }

    return true;
}

function filterStudentsForScope(students, scope) {
    if (!Array.isArray(students)) return [];
    if (!scope || (scope.hostel === 'All' && scope.block === 'All' && scope.floors === 'All' && scope.rooms === 'All')) {
        return students;
    }
    return students.filter(student => isStudentInScope(student, scope));
}

function isComplaintInScope(complaint, scope) {
    if (!scope || !scope.isActive) return false;
    if (scope.block === 'All' && scope.rooms === 'All' && scope.floors === 'All') return true;

    if (scope.block && normalizeString(scope.block) !== 'all') {
        const compBlock = normalizeBlock(complaint.block || complaint.hostelBlock);
        const scopeBlock = normalizeBlock(scope.block);
        if (compBlock !== 'all' && compBlock !== scopeBlock) return false;
    }

    if (scope.rooms && normalizeString(scope.rooms) !== 'all') {
        if (!isRoomInRange(complaint.roomNumber || complaint.room, scope.rooms)) return false;
    }

    return true;
}

function isGatePassInScope(gatePass, scope) {
    if (!scope || !scope.isActive) return false;
    if (scope.block === 'All' && scope.rooms === 'All' && scope.floors === 'All') return true;

    if (scope.block && normalizeString(scope.block) !== 'all') {
        const gpBlock = normalizeBlock(gatePass.block || gatePass.hostelBlock);
        const scopeBlock = normalizeBlock(scope.block);
        if (gpBlock !== 'all' && gpBlock !== scopeBlock) return false;
    }

    if (scope.rooms && normalizeString(scope.rooms) !== 'all') {
        if (!isRoomInRange(gatePass.roomNumber || gatePass.room, scope.rooms)) return false;
    }

    return true;
}

module.exports = {
    isStudentInScope,
    filterStudentsForScope,
    isComplaintInScope,
    isGatePassInScope,
    extractFloorFromRoom,
    isRoomInRange
};
