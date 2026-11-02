<?php

class Database
{
    private \PDO $pdo;

    public function __construct(array $config)
    {
        $dsn = sprintf(
            'mysql:host=%s;port=%s;dbname=%s;charset=%s',
            $config['host'],
            $config['port'] ?? 3306,
            $config['name'],
            $config['charset'] ?? 'utf8mb4'
        );

        $this->pdo = new \PDO($dsn, $config['user'], $config['pass'], [
            \PDO::ATTR_ERRMODE => \PDO::ERRMODE_EXCEPTION,
            \PDO::ATTR_DEFAULT_FETCH_MODE => \PDO::FETCH_ASSOC,
        ]);
    }

    public function pdo(): \PDO
    {
        return $this->pdo;
    }
}

