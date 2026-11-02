<?php

class VideoRepository
{
    private ?Database $db;

    public function __construct(?Database $db = null)
    {
        $this->db = $db;
    }

    public function sampleRows(): array
    {
        return [
            [
                'youtube_id' => 'dQw4w9WgXcQ',
                'title' => 'Never Gonna Give You Up',
                'channel_name' => 'Rick Astley',
                'thumbnail_url' => 'https://img.youtube.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
                'category' => 'music',
                'genre' => 'Pop',
                'duration' => 213,
                'view_count' => 1234567890,
                'like_count' => 9000000,
                'published_at' => '1987-10-25T00:00:00Z',
            ],
            [
                'youtube_id' => '9bZkp7q19f0',
                'title' => 'PSY - GANGNAM STYLE(강남스타일) M/V',
                'channel_name' => 'OfficialPSY',
                'thumbnail_url' => 'https://img.youtube.com/vi/9bZkp7q19f0/hqdefault.jpg',
                'category' => 'music',
                'genre' => 'K-Pop',
                'duration' => 253,
                'view_count' => 4800000000,
                'like_count' => 26000000,
                'published_at' => '2012-07-15T00:00:00Z',
            ],
        ];
    }

    public function saveMany(array $videos): void
    {
        if (!$this->db || !$videos) {
            return;
        }

        $pdo = $this->db->pdo();
        $sql = "INSERT INTO videos
            (youtube_id, title, description, thumbnail_url, channel_name, channel_id, category, genre, duration, view_count, like_count, published_at, scraped_at)
            VALUES
            (:youtube_id, :title, :description, :thumbnail_url, :channel_name, :channel_id, :category, :genre, :duration, :view_count, :like_count, :published_at, NOW())
            ON DUPLICATE KEY UPDATE
                title = VALUES(title),
                description = VALUES(description),
                thumbnail_url = VALUES(thumbnail_url),
                channel_name = VALUES(channel_name),
                channel_id = VALUES(channel_id),
                category = VALUES(category),
                genre = VALUES(genre),
                duration = VALUES(duration),
                view_count = VALUES(view_count),
                like_count = VALUES(like_count),
                published_at = VALUES(published_at),
                scraped_at = NOW()";

        $stmt = $pdo->prepare($sql);
        foreach ($videos as $v) {
            $stmt->execute([
                ':youtube_id' => $v['youtube_id'] ?? null,
                ':title' => $v['title'] ?? '',
                ':description' => $v['description'] ?? '',
                ':thumbnail_url' => $v['thumbnail_url'] ?? null,
                ':channel_name' => $v['channel_name'] ?? '',
                ':channel_id' => $v['channel_id'] ?? null,
                ':category' => $v['category'] ?? null,
                ':genre' => $v['genre'] ?? null,
                ':duration' => $v['duration'] ?? null,
                ':view_count' => $v['view_count'] ?? null,
                ':like_count' => $v['like_count'] ?? null,
                ':published_at' => $v['published_at'] ? date('Y-m-d H:i:s', strtotime($v['published_at'])) : null,
            ]);
        }
    }

    public function recent(int $limit = 24): array
    {
        if (!$this->db) {
            return $this->sampleRows();
        }
        $pdo = $this->db->pdo();
        $stmt = $pdo->prepare("SELECT youtube_id, title, description, thumbnail_url, channel_name, channel_id, category, genre, duration, view_count, like_count, published_at
            FROM videos ORDER BY scraped_at DESC LIMIT :lim");
        $stmt->bindValue(':lim', $limit, \PDO::PARAM_INT);
        $stmt->execute();
        $rows = $stmt->fetchAll();
        return $rows ?: $this->sampleRows();
    }
}

