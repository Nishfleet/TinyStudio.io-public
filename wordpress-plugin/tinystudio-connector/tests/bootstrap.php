<?php
/**
 * PHPUnit bootstrap for the TinyStudio Connector test suite.
 *
 * The SEO plugin under test is named with TINYSTUDIO_TEST_SEO_PLUGIN (the
 * plugin basename) so the suite runs once per SEO plugin in CI.
 *
 * @package tinystudio-connector
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

$_tests_dir = getenv( 'WP_TESTS_DIR' );

if ( ! $_tests_dir ) {
	$_tests_dir = '/wordpress-phpunit';
}

if ( ! file_exists( "{$_tests_dir}/includes/functions.php" ) ) {
	echo "Could not find the WordPress test library at {$_tests_dir}.\n";
	exit( 1 );
}

// Give tests access to the helper functions.
require_once "{$_tests_dir}/includes/functions.php";

tests_add_filter(
	'muplugins_loaded',
	static function () {
		// Activate the SEO plugin under test, so its install routines (custom
		// tables, role capabilities) run exactly as they would on a real site.
		$seo_plugin = getenv( 'TINYSTUDIO_TEST_SEO_PLUGIN' );

		if ( $seo_plugin ) {
			require_once ABSPATH . 'wp-admin/includes/plugin.php';

			if ( ! is_plugin_active( $seo_plugin ) ) {
				$result = activate_plugin( $seo_plugin );

				if ( is_wp_error( $result ) ) {
					echo "Could not activate the SEO plugin under test ({$seo_plugin}): " . $result->get_error_message() . "\n";
					exit( 1 );
				}
			}
		}

		require_once dirname( __DIR__ ) . '/tinystudio-connector.php';
	}
);

// Start up the WP testing environment.
require "{$_tests_dir}/includes/bootstrap.php";
