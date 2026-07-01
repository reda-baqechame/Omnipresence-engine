<?php
/**
 * Plugin Name: PresenceOS Traffic Pixel
 * Description: Opt-in Layer 2 traffic panel observation for PresenceOS Traffic Intelligence.
 * Version: 1.0.0
 * Author: PresenceOS
 */

if (!defined('ABSPATH')) {
    exit;
}

function presenceos_traffic_pixel_settings(): array {
    return [
        'project_id' => get_option('presenceos_project_id', ''),
        'app_url' => rtrim(get_option('presenceos_app_url', ''), '/'),
        'domain' => wp_parse_url(home_url(), PHP_URL_HOST),
    ];
}

function presenceos_traffic_pixel_script(): void {
    $cfg = presenceos_traffic_pixel_settings();
    if (empty($cfg['project_id']) || empty($cfg['app_url']) || empty($cfg['domain'])) {
        return;
    }
    $src = $cfg['app_url'] . '/api/traffic-panel/pixel.js?projectId=' . rawurlencode($cfg['project_id']) . '&domain=' . rawurlencode($cfg['domain']);
    echo '<script src="' . esc_url($src) . '" async defer></script>' . "\n";
}
add_action('wp_footer', 'presenceos_traffic_pixel_script');

function presenceos_traffic_pixel_admin_menu(): void {
    add_options_page('PresenceOS Pixel', 'PresenceOS Pixel', 'manage_options', 'presenceos-pixel', 'presenceos_traffic_pixel_admin_page');
}
add_action('admin_menu', 'presenceos_traffic_pixel_admin_menu');

function presenceos_traffic_pixel_admin_page(): void {
    if ($_SERVER['REQUEST_METHOD'] === 'POST' && check_admin_referer('presenceos_pixel_save')) {
        update_option('presenceos_project_id', sanitize_text_field($_POST['presenceos_project_id'] ?? ''));
        update_option('presenceos_app_url', esc_url_raw($_POST['presenceos_app_url'] ?? ''));
        echo '<div class="updated"><p>Settings saved.</p></div>';
    }
    $project_id = esc_attr(get_option('presenceos_project_id', ''));
    $app_url = esc_attr(get_option('presenceos_app_url', ''));
    echo '<div class="wrap"><h1>PresenceOS Traffic Pixel</h1>';
    echo '<form method="post">';
    wp_nonce_field('presenceos_pixel_save');
    echo '<table class="form-table">';
    echo '<tr><th>Project ID</th><td><input name="presenceos_project_id" value="' . $project_id . '" class="regular-text" /></td></tr>';
    echo '<tr><th>App URL</th><td><input name="presenceos_app_url" value="' . $app_url . '" class="regular-text" placeholder="https://your-app.vercel.app" /></td></tr>';
    echo '</table><p class="submit"><button type="submit" class="button button-primary">Save</button></p></form></div>';
}
