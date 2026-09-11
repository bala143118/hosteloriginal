const { getSupabaseClient } = require('./supabaseClient');
const db = require('../db');

class InventoryRepository {
    constructor() {
        this.tableName = 'inventory';
    }

    async getAll() {
        try {
            const res = await db.query('SELECT * FROM inventory ORDER BY item_name ASC');
            if (res.rows && res.rows.length > 0) {
                return res.rows.map(r => this._mapItem(r));
            }
        } catch (e) {}

        const client = getSupabaseClient();
        if (!client) return [];
        try {
            const { data, error } = await client.from(this.tableName).select('*').order('item_name', { ascending: true });
            if (error) return [];
            return data.map(r => this._mapItem(r));
        } catch (e) {
            return [];
        }
    }

    async create(item) {
        const id = item.id || 'INV-' + Date.now();
        const itemName = item.itemName || item.name || 'Maintenance Item';
        const category = item.category || 'General';
        const quantity = parseInt(item.quantity || 0, 10);
        const minThreshold = parseInt(item.minStock || item.min_threshold || 5, 10);
        const unit = item.unit || 'pcs';

        try {
            const res = await db.query(
                `INSERT INTO inventory (id, item_name, category, quantity, min_threshold, unit, updated_at)
                 VALUES ($1, $2, $3, $4, $5, $6, NOW())
                 ON CONFLICT (id) DO UPDATE SET
                    item_name = EXCLUDED.item_name,
                    category = EXCLUDED.category,
                    quantity = EXCLUDED.quantity,
                    min_threshold = EXCLUDED.min_threshold,
                    unit = EXCLUDED.unit,
                    updated_at = NOW()
                 RETURNING *`,
                [id, itemName, category, quantity, minThreshold, unit]
            );
            if (res.rows && res.rows.length > 0) {
                return this._mapItem(res.rows[0]);
            }
        } catch (pgErr) {
            console.error('[InventoryRepository PostgreSQL Create Error]', pgErr.message);
        }

        const client = getSupabaseClient();
        if (!client) {
            return this._mapItem({ id, item_name: itemName, category, quantity, min_threshold: minThreshold, unit });
        }

        const payload = {
            id,
            item_name: itemName,
            category,
            quantity,
            unit,
            min_stock: minThreshold,
            location: item.location || 'Central Maintenance Store',
            status: item.status || 'In Stock'
        };

        try {
            const { data, error } = await client.from(this.tableName).insert([payload]).select().single();
            if (error) return this._mapItem(payload);
            return this._mapItem(data);
        } catch (e) {
            return this._mapItem(payload);
        }
    }

    async updateStock(id, newQuantity) {
        if (!id) return null;
        const cleanId = String(id).trim();

        try {
            const res = await db.query(
                `UPDATE inventory SET quantity = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
                [newQuantity, cleanId]
            );
            if (res.rows && res.rows.length > 0) {
                return this._mapItem(res.rows[0]);
            }
        } catch (e) {}

        const client = getSupabaseClient();
        if (!client) return null;

        const status = newQuantity <= 0 ? 'Out of Stock' : newQuantity <= 5 ? 'Low Stock' : 'In Stock';
        try {
            const { data, error } = await client
                .from(this.tableName)
                .update({ quantity: newQuantity, status, last_restocked_at: new Date().toISOString() })
                .eq('id', cleanId)
                .select()
                .single();

            if (error) return null;
            return this._mapItem(data);
        } catch (e) {
            return null;
        }
    }

    _mapItem(row) {
        if (!row) return null;
        const itemName = row.item_name || row.itemName || row.name || 'Maintenance Item';
        const qty = row.quantity !== undefined ? row.quantity : 0;
        const minStock = row.min_threshold || row.min_stock || 5;

        return {
            id: row.id,
            itemName: itemName,
            name: itemName,
            category: row.category || 'General',
            quantity: qty,
            unit: row.unit || 'pcs',
            minStock: minStock,
            minThreshold: minStock,
            location: row.location || 'Central Store',
            status: qty <= 0 ? 'Out of Stock' : qty <= minStock ? 'Low Stock' : 'In Stock',
            lastRestockedAt: row.last_restocked_at || row.updated_at || new Date().toISOString(),
            createdAt: row.created_at || row.updated_at || new Date().toISOString(),
            updatedAt: row.updated_at || new Date().toISOString()
        };
    }
}

module.exports = new InventoryRepository();
