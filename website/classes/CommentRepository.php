<?php

class CommentRepository
{
    public function sample(string $videoId): array
    {
        return [
            [
                'id' => 'c1',
                'video_id' => $videoId,
                'author_name' => 'Sparkle Bug',
                'text' => 'THIS IS THE SOUNDTRACK TO OUR LEGEND!!!',
                'like_count' => 420,
                'published_at' => date(DATE_ATOM, strtotime('-2 hours')),
            ],
            [
                'id' => 'c2',
                'video_id' => $videoId,
                'author_name' => 'Technomancer D',
                'text' => 'DUNDUN DUNDUN DAH DAH DAH DUN!!!',
                'like_count' => 111,
                'published_at' => date(DATE_ATOM, strtotime('-30 minutes')),
            ],
        ];
    }
}

