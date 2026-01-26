'use strict';

/**
 * StateCache - Provides caching for adapter state operations.
 * Reduces database queries by caching state values during update cycles.
 */
class StateCache {
    /**
     * Creates a new StateCache instance
     *
     * @param {object} adapter - ioBroker adapter instance
     * @param {object} [options] - Configuration options
     * @param {number} [options.maxAge] - Maximum cache age in milliseconds (default: 60s)
     * @param {number} [options.maxSize] - Maximum number of cached entries
     */
    constructor(adapter, options = {}) {
        this.adapter = adapter;
        this.cache = new Map();
        this.maxAge = options.maxAge || 60000;
        this.maxSize = options.maxSize || 1000;
        this.hits = 0;
        this.misses = 0;
    }

    /**
     * Gets a state value, using cache if available
     *
     * @param {string} id - State ID
     * @returns {Promise<any>} State value or null
     */
    async get(id) {
        const cached = this.cache.get(id);
        const now = Date.now();

        if (cached && now - cached.timestamp < this.maxAge) {
            this.hits++;
            return cached.value;
        }

        this.misses++;
        const state = await this.adapter.getStateAsync(id);
        const value = state?.val ?? null;

        this._set(id, value);
        return value;
    }

    /**
     * Gets a state object (with val, ack, ts), using cache if available
     *
     * @param {string} id - State ID
     * @returns {Promise<object|null>} State object or null
     */
    async getState(id) {
        const cached = this.cache.get(`${id}_state`);
        const now = Date.now();

        if (cached && now - cached.timestamp < this.maxAge) {
            this.hits++;
            return cached.value;
        }

        this.misses++;
        const state = await this.adapter.getStateAsync(id);

        this._set(`${id}_state`, state);
        if (state) {
            this._set(id, state.val);
        }
        return state;
    }

    /**
     * Sets a state value and updates cache
     *
     * @param {string} id - State ID
     * @param {any} value - Value to set
     * @param {boolean} ack - Acknowledge flag
     * @returns {Promise<void>}
     */
    async set(id, value, ack = true) {
        await this.adapter.setStateAsync(id, value, ack);
        this._set(id, value);
    }

    /**
     * Internal method to add to cache
     *
     * @param {string} id - State ID
     * @param {any} value - Value to cache
     */
    _set(id, value) {
        // Evict oldest entries if cache is full
        if (this.cache.size >= this.maxSize) {
            const oldestKey = this.cache.keys().next().value;
            this.cache.delete(oldestKey);
        }

        this.cache.set(id, {
            value,
            timestamp: Date.now(),
        });
    }

    /**
     * Clears the entire cache.
     * Should be called at the end of each update cycle.
     */
    clear() {
        this.cache.clear();
    }

    /**
     * Invalidates a specific cache entry
     *
     * @param {string} id - State ID to invalidate
     */
    invalidate(id) {
        this.cache.delete(id);
        this.cache.delete(`${id}_state`);
    }

    /**
     * Gets cache statistics
     *
     * @returns {object} Cache statistics
     */
    getStats() {
        const total = this.hits + this.misses;
        return {
            hits: this.hits,
            misses: this.misses,
            hitRate: total > 0 ? `${((this.hits / total) * 100).toFixed(1)}%` : '0%',
            size: this.cache.size,
        };
    }

    /**
     * Resets cache statistics
     */
    resetStats() {
        this.hits = 0;
        this.misses = 0;
    }
}

module.exports = StateCache;
