<?php

class YouTubeClient
{
    private string $apiKey;
    private string $baseUrl = 'https://www.googleapis.com/youtube/v3';

    public function __construct(string $apiKey)
    {
        $this->apiKey = $apiKey;
    }

    public function search(array $params): array
    {
        $defaults = [
            'part' => 'snippet',
            'maxResults' => 25,
            'type' => 'video',
        ];
        return $this->request('/search', array_merge($defaults, $params));
    }

    public function videosList(array $params): array
    {
        $defaults = [
            'part' => 'snippet,contentDetails,statistics',
            'maxResults' => 25,
        ];
        return $this->request('/videos', array_merge($defaults, $params));
    }

    private function request(string $path, array $params): array
    {
        $params['key'] = $this->apiKey;
        $url = $this->baseUrl . $path . '?' . http_build_query($params);

        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => 10,
            CURLOPT_SSL_VERIFYPEER => true,
        ]);

        $body = curl_exec($ch);
        $err = curl_error($ch);
        $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);

        if ($body === false || $code >= 400) {
            throw new \RuntimeException('YouTube API request failed: ' . ($err ?: 'HTTP ' . $code));
        }

        $data = json_decode($body, true);
        return $data ?? [];
    }
}

