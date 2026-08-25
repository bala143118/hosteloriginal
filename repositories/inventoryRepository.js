const { getSupabaseClient } = require('./supabaseClient');

class InventoryRepository {
    constructor() {
        this.tableName = 'inventory';
    }

    async getAll() {
        const client = getSupabaseClient();
        if (!client) return null;
        const { data, error } = await client.from(this.tableName).select('*').order('item_name', { ascending: true });
        if (error) throw error;
        return data.map(this._mapItem);
    }

    async create(item) {
        const client = getSupabaseClient();
        if (!client) return null;
        const payload = {
            id: item.id || 'INV-' + Date.now(),
            item_name: item.itemName || item.name,
            category: item.category,
            quantity: parseInt(item.quantity || 0, 10),
            unit: item.unit || 'units',
            min_stock: parseInt(item.minStock || 5, 10),
            location: item.location || 'Central Maintenance Store',
            status: item.status || 'In Stock'
        };
        const { data, error } = await client.from(this.tableName).insert([payload]).select().single();
        if (error) throw error;
        return this._mapItem(data);
    }

    async updateStock(id, newQuantity) {
        const client = getSupabaseClient();
        if (!client) return null;
        const status = newQuantity <= 0 ? 'Out of Stock' : newQuantity <= 5 ? 'Low Stock' : 'In Stock';
        const { data, error } = await client
            .from(this.tableName)
            .update({ quantity: newQuantity, status, last_restocked_at: new Date().toISOString() })
            .eq('id', id)
            .select()
            .single();
        if (error) throw error;
        return this._mapItem(data);
    }

    _mapItem(row) {
        if (!row) return null;
        return {
            id: row.id,
            itemName: row.item_name,
            name: row.item_name,
            category: row.category,
            quantity: row.quantity,
            unit: row.unit,
            minStock: row.min_stock,
            location: row.location,
            status: row.status,
            lastRestockedAt: row.last_restocked_at,
            createdAt: row.created_at,
            updatedAt: row.updated_at
        };
    }
}

module.exports = new InventoryRepository();
