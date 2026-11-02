<?php

require_once __DIR__ . '/../classes/Response.php';
require_once __DIR__ . '/../classes/CommentRepository.php';

$videoId = $_GET['videoId'] ?? null;
if (!$videoId) {
    Response::error('Missing videoId', 400);
    exit;
}

$repo = new CommentRepository();
$payload = [
    'success' => true,
    'data' => [
        'comments' => $repo->sample($videoId),
    ],
    'meta' => [
        'source' => 'sample',
    ],
];

Response::json($payload);

