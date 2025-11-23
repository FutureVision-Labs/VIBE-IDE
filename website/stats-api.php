<?php
/**
 * VIBE IDE Stats API
 * Reads server log files and returns JSON data for the stats page
 * Compatible with Apache combined log format, IIS W3C format, and AWStats data files
 */

header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');

// Configuration
$logDir = '/home/username/logs/'; // Update with your actual log directory
$awstatsDataPath = '/home/username/awstats/'; // Path to AWStats data files
$currentMonth = date('M-Y'); // Format: Nov-2025
$logPattern = 'vibeide.net-ssl_log-' . $currentMonth . '.gz'; // Gzipped log file pattern

// Function to parse Apache combined log format (handles gzipped files)
function parseApacheLog($logFile) {
    $stats = [
        'totalPages' => 0,
        'totalHits' => 0,
        'totalBandwidth' => 0,
        'countries' => []
    ];
    
    if (!file_exists($logFile)) {
        return $stats;
    }
    
    // Check if file is gzipped
    $isGzipped = (substr($logFile, -3) === '.gz');
    
    if ($isGzipped) {
        // Open gzipped file
        $handle = gzopen($logFile, 'r');
        if (!$handle) {
            return $stats;
        }
    } else {
        // Open regular file
        $handle = fopen($logFile, 'r');
        if (!$handle) {
            return $stats;
        }
    }
    
    // Simple IP to country mapping (you'd use GeoIP in production)
    $ipToCountry = [];
    
    // Read lines (handles both gzipped and regular files)
    while (true) {
        if ($isGzipped) {
            $line = gzgets($handle);
            if ($line === false) break;
        } else {
            $line = fgets($handle);
            if ($line === false) break;
        }
        // Parse Apache combined log format:
        // IP - - [DATE] "METHOD URL PROTOCOL" STATUS SIZE "REFERER" "USER-AGENT"
        if (preg_match('/^(\S+) .* \[.*\] ".*" (\d+) (\d+|-) ".*" ".*"$/', $line, $matches)) {
            $ip = $matches[1];
            $status = (int)$matches[2];
            $size = $matches[3] === '-' ? 0 : (int)$matches[3];
            
            // Only count successful requests (2xx, 3xx)
            if ($status >= 200 && $status < 400) {
                $stats['totalHits']++;
                $stats['totalBandwidth'] += $size;
                
                // Count pages (HTML files, not images/CSS/JS)
                if (preg_match('/\.(html|htm|php|asp|aspx)$/i', $line)) {
                    $stats['totalPages']++;
                }
                
                // Get country from IP (simplified - use GeoIP library in production)
                $country = getCountryFromIP($ip);
                if (!isset($stats['countries'][$country])) {
                    $stats['countries'][$country] = [
                        'pages' => 0,
                        'hits' => 0,
                        'bandwidth' => 0
                    ];
                }
                
                if (preg_match('/\.(html|htm|php|asp|aspx)$/i', $line)) {
                    $stats['countries'][$country]['pages']++;
                }
                $stats['countries'][$country]['hits']++;
                $stats['countries'][$country]['bandwidth'] += $size;
            }
        }
    }
    
    if ($isGzipped) {
        gzclose($handle);
    } else {
        fclose($handle);
    }
    return $stats;
}

// Function to find log file (handles gzipped files)
function findLogFile($logDir, $pattern) {
    // Try exact pattern match first
    $exactPath = $logDir . $pattern;
    if (file_exists($exactPath)) {
        return $exactPath;
    }
    
    // Try to find any matching log file
    $files = glob($logDir . '*.gz');
    if (empty($files)) {
        $files = glob($logDir . '*.log');
    }
    
    // Return most recent file if pattern doesn't match
    if (!empty($files)) {
        usort($files, function($a, $b) {
            return filemtime($b) - filemtime($a);
        });
        return $files[0];
    }
    
    return null;
}

// Function to read AWStats data file
function parseAWStatsData($dataFile) {
    $stats = [
        'totalPages' => 0,
        'totalHits' => 0,
        'totalBandwidth' => 0,
        'countries' => []
    ];
    
    if (!file_exists($dataFile)) {
        return $stats;
    }
    
    $content = file_get_contents($dataFile);
    
    // Parse AWStats data file format
    // Look for lines like: LastLine 12345
    if (preg_match('/LastLine (\d+)/', $content, $matches)) {
        $stats['totalHits'] = (int)$matches[1];
    }
    
    // Parse country data
    if (preg_match('/BEGIN_COUNTRY(.*?)END_COUNTRY/s', $content, $matches)) {
        $countryData = $matches[1];
        // Parse country entries
        preg_match_all('/^(\w+)\s+(\d+)\s+(\d+)\s+(\d+)/m', $countryData, $countryMatches, PREG_SET_ORDER);
        foreach ($countryMatches as $match) {
            $countryCode = strtolower($match[1]);
            $pages = (int)$match[2];
            $hits = (int)$match[3];
            $bandwidth = (int)$match[4];
            
            $stats['countries'][$countryCode] = [
                'pages' => $pages,
                'hits' => $hits,
                'bandwidth' => $bandwidth
            ];
            $stats['totalPages'] += $pages;
        }
    }
    
    return $stats;
}

// Simple IP to country lookup (use GeoIP library in production)
function getCountryFromIP($ip) {
    // This is a simplified version - use GeoIP library for accurate results
    // For now, return 'us' as default
    return 'us';
}

// Try to read AWStats data file first (more accurate)
$awstatsFile = $awstatsDataPath . 'awstats' . date('Ym') . '.txt';
$stats = parseAWStatsData($awstatsFile);

// If AWStats data not available, try reading log file directly
if ($stats['totalHits'] === 0) {
    $logFile = findLogFile($logDir, $logPattern);
    if ($logFile) {
        $stats = parseApacheLog($logFile);
    }
}

// Format country data with names and flags
$countryNames = [
    'us' => ['name' => 'United States', 'flag' => '🇺🇸'],
    'gb' => ['name' => 'Great Britain', 'flag' => '🇬🇧'],
    'ca' => ['name' => 'Canada', 'flag' => '🇨🇦'],
    'bd' => ['name' => 'Bangladesh', 'flag' => '🇧🇩'],
    'au' => ['name' => 'Australia', 'flag' => '🇦🇺'],
    'de' => ['name' => 'Germany', 'flag' => '🇩🇪'],
    'fr' => ['name' => 'France', 'flag' => '🇫🇷'],
    'jp' => ['name' => 'Japan', 'flag' => '🇯🇵'],
    'cn' => ['name' => 'China', 'flag' => '🇨🇳'],
    'in' => ['name' => 'India', 'flag' => '🇮🇳']
];

$formattedCountries = [];
foreach ($stats['countries'] as $code => $data) {
    $name = isset($countryNames[$code]) ? $countryNames[$code]['name'] : ucfirst($code);
    $flag = isset($countryNames[$code]) ? $countryNames[$code]['flag'] : '🌍';
    
    $formattedCountries[] = [
        'code' => $code,
        'name' => $name,
        'flag' => $flag,
        'pages' => $data['pages'],
        'hits' => $data['hits'],
        'bandwidth' => $data['bandwidth']
    ];
}

// Sort by hits (descending)
usort($formattedCountries, function($a, $b) {
    return $b['hits'] - $a['hits'];
});

// Format bandwidth
function formatBytes($bytes) {
    if ($bytes >= 1048576) {
        return number_format($bytes / 1048576, 2) . ' MB';
    } elseif ($bytes >= 1024) {
        return number_format($bytes / 1024, 2) . ' KB';
    }
    return $bytes . ' B';
}

$response = [
    'totalPages' => $stats['totalPages'],
    'totalHits' => $stats['totalHits'],
    'totalBandwidth' => formatBytes($stats['totalBandwidth']),
    'totalBandwidthBytes' => $stats['totalBandwidth'],
    'countryCount' => count($formattedCountries),
    'countries' => $formattedCountries,
    'lastUpdated' => date('F Y'),
    'timestamp' => time()
];

echo json_encode($response, JSON_PRETTY_PRINT);
?>

