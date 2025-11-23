/**
 * VIBE IDE Stats API (Node.js version)
 * Reads server log files and returns JSON data for the stats page
 * Compatible with Apache combined log format, IIS W3C format, and AWStats data files
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');

// Configuration - Update these paths for your server
const LOG_DIR = process.env.LOG_DIR || '/var/log/apache2/';
const AWSTATS_DATA_PATH = process.env.AWSTATS_PATH || '/var/lib/awstats/';
const CURRENT_MONTH = new Date().toLocaleDateString('en-US', { month: 'short', year: 'numeric' }); // Format: Nov-2025
const zlib = require('zlib');
const { promisify } = require('util');
const gunzip = promisify(zlib.gunzip);

// Country code to name mapping
const COUNTRY_NAMES = {
    'us': { name: 'United States', flag: '🇺🇸' },
    'gb': { name: 'Great Britain', flag: '🇬🇧' },
    'ca': { name: 'Canada', flag: '🇨🇦' },
    'bd': { name: 'Bangladesh', flag: '🇧🇩' },
    'au': { name: 'Australia', flag: '🇦🇺' },
    'de': { name: 'Germany', flag: '🇩🇪' },
    'fr': { name: 'France', flag: '🇫🇷' },
    'jp': { name: 'Japan', flag: '🇯🇵' },
    'cn': { name: 'China', flag: '🇨🇳' },
    'in': { name: 'India', flag: '🇮🇳' }
};

/**
 * Parse Apache combined log format (handles gzipped files)
 */
async function parseApacheLog(logFile) {
    const stats = {
        totalPages: 0,
        totalHits: 0,
        totalBandwidth: 0,
        countries: {}
    };

    if (!fs.existsSync(logFile)) {
        return stats;
    }

    // Check if file is gzipped
    const isGzipped = logFile.endsWith('.gz');
    
    let inputStream;
    if (isGzipped) {
        // Create gunzip stream for gzipped files
        const fileBuffer = fs.readFileSync(logFile);
        const decompressed = await gunzip(fileBuffer);
        inputStream = require('stream').Readable.from(decompressed.toString());
    } else {
        // Regular file stream
        inputStream = fs.createReadStream(logFile);
    }

    const rl = readline.createInterface({
        input: inputStream,
        crlfDelay: Infinity
    });

    for await (const line of rl) {
        // Parse Apache combined log format:
        // IP - - [DATE] "METHOD URL PROTOCOL" STATUS SIZE "REFERER" "USER-AGENT"
        const match = line.match(/^(\S+) .* \[.*\] ".*" (\d+) (\d+|-) ".*" ".*"$/);
        if (match) {
            const ip = match[1];
            const status = parseInt(match[2]);
            const size = match[3] === '-' ? 0 : parseInt(match[3]);

            // Only count successful requests (2xx, 3xx)
            if (status >= 200 && status < 400) {
                stats.totalHits++;
                stats.totalBandwidth += size;

                // Count pages (HTML files, not images/CSS/JS)
                if (/\.(html|htm|php|asp|aspx)$/i.test(line)) {
                    stats.totalPages++;
                }

                // Get country from IP (simplified - use GeoIP library in production)
                const country = getCountryFromIP(ip);
                if (!stats.countries[country]) {
                    stats.countries[country] = {
                        pages: 0,
                        hits: 0,
                        bandwidth: 0
                    };
                }

                if (/\.(html|htm|php|asp|aspx)$/i.test(line)) {
                    stats.countries[country].pages++;
                }
                stats.countries[country].hits++;
                stats.countries[country].bandwidth += size;
            }
        }
    }

    return stats;
}

/**
 * Find log file (handles gzipped files with pattern matching)
 */
function findLogFile(logDir, pattern) {
    // Try exact pattern match first
    const exactPath = path.join(logDir, pattern);
    if (fs.existsSync(exactPath)) {
        return exactPath;
    }
    
    // Try to find any matching log file
    let files = [];
    try {
        files = fs.readdirSync(logDir)
            .filter(file => file.endsWith('.gz') || file.endsWith('.log'))
            .map(file => path.join(logDir, file));
    } catch (error) {
        console.error('Error reading log directory:', error);
        return null;
    }
    
    // Return most recent file if pattern doesn't match
    if (files.length > 0) {
        files.sort((a, b) => {
            const statA = fs.statSync(a);
            const statB = fs.statSync(b);
            return statB.mtime - statA.mtime;
        });
        return files[0];
    }
    
    return null;
}

/**
 * Parse AWStats data file
 */
function parseAWStatsData(dataFile) {
    const stats = {
        totalPages: 0,
        totalHits: 0,
        totalBandwidth: 0,
        countries: {}
    };

    if (!fs.existsSync(dataFile)) {
        return stats;
    }

    const content = fs.readFileSync(dataFile, 'utf8');

    // Parse AWStats data file format
    // Look for lines like: LastLine 12345
    const lastLineMatch = content.match(/LastLine (\d+)/);
    if (lastLineMatch) {
        stats.totalHits = parseInt(lastLineMatch[1]);
    }

    // Parse country data
    const countryMatch = content.match(/BEGIN_COUNTRY([\s\S]*?)END_COUNTRY/);
    if (countryMatch) {
        const countryData = countryMatch[1];
        // Parse country entries: CODE PAGES HITS BANDWIDTH
        const countryRegex = /^(\w+)\s+(\d+)\s+(\d+)\s+(\d+)/gm;
        let match;
        while ((match = countryRegex.exec(countryData)) !== null) {
            const countryCode = match[1].toLowerCase();
            const pages = parseInt(match[2]);
            const hits = parseInt(match[3]);
            const bandwidth = parseInt(match[4]);

            stats.countries[countryCode] = {
                pages: pages,
                hits: hits,
                bandwidth: bandwidth
            };
            stats.totalPages += pages;
        }
    }

    return stats;
}

/**
 * Simple IP to country lookup (use GeoIP library in production)
 */
function getCountryFromIP(ip) {
    // This is a simplified version - use GeoIP library for accurate results
    // For now, return 'us' as default
    return 'us';
}

/**
 * Format bytes to human-readable format
 */
function formatBytes(bytes) {
    if (bytes >= 1048576) {
        return (bytes / 1048576).toFixed(2) + ' MB';
    } else if (bytes >= 1024) {
        return (bytes / 1024).toFixed(2) + ' KB';
    }
    return bytes + ' B';
}

/**
 * Main function to get stats
 */
async function getStats() {
    // Try to read AWStats data file first (more accurate)
    const awstatsMonth = new Date().toISOString().slice(0, 7).replace('-', ''); // Format: YYYYMM
    const awstatsFile = path.join(AWSTATS_DATA_PATH, `awstats${awstatsMonth}.txt`);
    let stats = parseAWStatsData(awstatsFile);

    // If AWStats data not available, try reading log file directly
    if (stats.totalHits === 0) {
        const logPattern = `vibeide.net-ssl_log-${CURRENT_MONTH}.gz`;
        const logFile = findLogFile(LOG_DIR, logPattern);
        if (logFile) {
            stats = await parseApacheLog(logFile);
        }
    }

    // Format country data with names and flags
    const formattedCountries = [];
    for (const [code, data] of Object.entries(stats.countries)) {
        const countryInfo = COUNTRY_NAMES[code] || { name: code.toUpperCase(), flag: '🌍' };
        
        formattedCountries.push({
            code: code,
            name: countryInfo.name,
            flag: countryInfo.flag,
            pages: data.pages,
            hits: data.hits,
            bandwidth: data.bandwidth
        });
    }

    // Sort by hits (descending)
    formattedCountries.sort((a, b) => b.hits - a.hits);

    return {
        totalPages: stats.totalPages,
        totalHits: stats.totalHits,
        totalBandwidth: formatBytes(stats.totalBandwidth),
        totalBandwidthBytes: stats.totalBandwidth,
        countryCount: formattedCountries.length,
        countries: formattedCountries,
        lastUpdated: new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
        timestamp: Date.now()
    };
}

// If run as a script, output JSON
if (require.main === module) {
    getStats().then(stats => {
        console.log(JSON.stringify(stats, null, 2));
    }).catch(error => {
        console.error('Error getting stats:', error);
        process.exit(1);
    });
}

module.exports = { getStats, parseApacheLog, parseAWStatsData };

