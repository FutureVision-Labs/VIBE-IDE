<?php

class Response
{
    public static function json($data, int $status = 200): void
    {
        http_response_code($status);
        header('Content-Type: application/json; charset=utf-8');
        echo json_encode($data, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    }

    public static function error(string $message, int $status = 400, array $meta = []): void
    {
        self::json([
            'success' => false,
            'error' => $message,
            'meta' => $meta,
        ], $status);
    }
}

