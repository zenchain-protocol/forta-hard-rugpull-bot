import { fetchJwt } from "@fortanetwork/forta-bot";

const NODE_ENV = process.env.NODE_ENV || 'development';
const STORAGE_API_URL = process.env.STORAGE_API_URL || 'your_default_storage_api_url';

const testMode = NODE_ENV === 'production' ? 'production' : 'test';

const _token = async () => {
    const tk = await fetchJwt({});
    return { Authorization: `Bearer ${tk}` };
};

const fetchKey = async (key) => {
    const headers = {
        'Content-Type': 'application/json',
        Accept: 'application/json',
    };

    if (testMode === 'production') {
        const tokenHeaders = await _token();
        Object.assign(headers, tokenHeaders);
    }

    const url = `${STORAGE_API_URL}/value?key=${key}`;

    try {
        const response = await fetch(url, { headers });

        if (response.ok) {
            const data = await response.json();
            return data.data || null;
        } else if (response.status === 404) {
            console.warn(`Key not found: ${key}`);
            return null;
        } else {
            const errorText = await response.text();
            throw new Error(
                `Failed to fetch key: ${key}, Status: ${response.status}, Text: ${errorText}`
            );
        }
    } catch (error) {
        throw new Error(`Failed to fetch key: ${key}, Error: ${error.message}`);
    }
};

export const getSecrets = async () => {
    const keys = [
        'ETHERSCAN_API_KEY',
        'POLYGONSCAN_API_KEY',
        'BSCSCAN_API_KEY',
        'ARBISCAN_API_KEY',
        'OPTIMISTICSCAN_API_KEY',
        'FANTOMSCAN_API_KEY',
        'SNOWTRACE_API_KEY',
        'ZETTABLOCK_API_KEY',
        'ZENTRACE_API_KEY'
    ]

    const apiKeys = {};
    let allKeysNotFound = true;

    for (const key of keys) {
        const value = await fetchKey(key);
        if (value !== null) {
            allKeysNotFound = false;
        }
        apiKeys[key] = value || '';
    }

    if (allKeysNotFound) {
        throw new Error(
            'All keys returned 404. Something is wrong with the key fetching process.'
        );
    }

    return { apiKeys };
};