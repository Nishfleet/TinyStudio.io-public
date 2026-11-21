<?php
/**
 * Plugin Name:          TinyStudio Connector
 * Description:          Lets an approved TinyStudio change write the SEO fields a page's SEO plugin keeps out of reach of outside tools, through WordPress's own REST API.
 * Version:              1.0.0
 * Requires at least:    6.5
 * Requires PHP:         7.4
 * Author:               TinyStudio
 * Author URI:           https://tinystudio.io
 * License:              GPL-2.0-or-later
 * License URI:          https://www.gnu.org/licenses/gpl-2.0.html
 * Text Domain:          tinystudio-connector
 *
 * @package tinystudio-connector
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

define( 'TINYSTUDIO_CONNECTOR_VERSION', '1.0.0' );
define( 'TINYSTUDIO_CONNECTOR_FILE', __FILE__ );

require_once __DIR__ . '/includes/register-fields.php';

// Priority 20: after the SEO plugins have registered their own meta (Yoast registers
// at plugins_loaded 14), so a field the SEO plugin already exposes for writing is left
// exactly as the SEO plugin registered it and is never overwritten.
add_action( 'init', 'tinystudio_connector_register_seo_fields', 20 );
