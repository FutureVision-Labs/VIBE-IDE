<?php

require_once __DIR__ . '/../classes/Response.php';
require_once __DIR__ . '/../classes/VideoRepository.php';
require_once __DIR__ . '/../classes/Database.php';
require_once __DIR__ . '/../classes/YouTubeClient.php';

$configPath = __DIR__ . '/../config/config.php';
$cfg = file_exists($configPath) ? require $configPath : null;

$db = null;
if ($cfg && isset($cfg['db'])) {
    try {
        $db = new Database($cfg['db']);
    } catch (Throwable $e) {
        // In early scaffold we fall back to sample data if DB is not reachable.
        $db = null;
    }
}

// Helpers
function iso8601DurationToSeconds(string $duration): int
{
    $pattern = '/PT((\d+)H)?((\d+)M)?((\d+)S)?/';
    if (!preg_match($pattern, $duration, $matches)) {
        return 0;
    }
    $hours = (int)($matches[2] ?? 0);
    $mins = (int)($matches[4] ?? 0);
    $secs = (int)($matches[6] ?? 0);
    return $hours * 3600 + $mins * 60 + $secs;
}

function normalizeVideos(array $items): array
{
    $out = [];
    foreach ($items as $item) {
        $id = $item['id'] ?? ($item['id']['videoId'] ?? null);
        $snippet = $item['snippet'] ?? [];
        $stats = $item['statistics'] ?? [];
        $details = $item['contentDetails'] ?? [];
        $thumb = $snippet['thumbnails']['high']['url'] ?? ($snippet['thumbnails']['medium']['url'] ?? null);

        if (!$id || !$snippet) {
            continue;
        }

        $out[] = [
            'youtube_id' => $id,
            'title' => $snippet['title'] ?? '',
            'description' => $snippet['description'] ?? '',
            'channel_name' => $snippet['channelTitle'] ?? '',
            'thumbnail_url' => $thumb,
            'category' => $snippet['categoryId'] ?? null,
            'genre' => null,
            'duration' => isset($details['duration']) ? iso8601DurationToSeconds($details['duration']) : null,
            'view_count' => isset($stats['viewCount']) ? (int)$stats['viewCount'] : null,
            'like_count' => isset($stats['likeCount']) ? (int)$stats['likeCount'] : null,
            'published_at' => $snippet['publishedAt'] ?? null,
        ];
    }
    return $out;
}

$repo = new VideoRepository($db);
$source = 'sample';
$videos = $repo->recent($max);

// Attempt live YouTube trending fetch if API key present.
$apiKey = $cfg['youtube_api_key'] ?? null;
$region = $_GET['region'] ?? 'US';
$categoryId = $_GET['categoryId'] ?? null;
$max = max(5, min(25, (int)($_GET['max'] ?? 12)));

if ($apiKey) {
    try {
        $yt = new YouTubeClient($apiKey);
        $params = [
            'chart' => 'mostPopular',
            'regionCode' => $region,
            'maxResults' => $max,
        ];
        if ($categoryId) {
            $params['videoCategoryId'] = $categoryId;
        }
        $res = $yt->videosList($params);
        $items = $res['items'] ?? [];
        $liveVideos = normalizeVideos($items);
        if ($liveVideos) {
            $videos = $liveVideos;
            $source = 'youtube';
            // Try to persist to DB if available.
            if ($db) {
                $repo->saveMany($liveVideos);
            }
        }
    } catch (Throwable $e) {
        // Keep sample fallback; include error meta for visibility.
        $source = 'sample';
        $error = $e->getMessage();
    }
}

$payload = [
    'success' => true,
    'data' => [
        'videos' => $videos,
    ],
    'meta' => [
        'source' => $source,
        'region' => $region,
        'categoryId' => $categoryId,
        'max' => $max,
    ],
];

if (isset($error)) {
    $payload['meta']['error'] = $error;
}

Response::json($payload);

