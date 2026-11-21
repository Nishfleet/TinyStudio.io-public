<?php
/**
 * PHPUnit bootstrap for the TinyStudio Connector test suite.
 *
 * The SEO plugin under test is named with TINYSTUDIO_TEST_SEO_PLUGIN (the
 * plugin basename) so the suite runs once per SEO plugin in CI.
 *
 * @package tinystudio-connector
 */

// This bootstrap runs before WordPress loads, so it must not test for the
// ABSPATH constant: PHPUnit runs it first and an early exit here would end
// the whole run silently, with no tests executed.

$_tests_dir = getenv( 'WP_TESTS_DIR' );

if ( ! $_tests_dir ) {
	$_tests_dir = '/wordpress-phpunit';
}

if ( ! file_exists( "{$_tests_dir}/includes/functions.php" ) ) {
	echo esc_html( "Could not find the WordPress test library at {$_tests_dir}.\n" );
	exit( 1 );
}

// The WP test suite requires the PHPUnit Polyfills, and the test container
// has none of its own, so point it at the plugin's own copy, which composer
// install puts under vendor. The path must name the package's root
// directory, where its phpunitpolyfills-autoload.php lives.
if ( ! defined( 'WP_TESTS_PHPUNIT_POLYFILLS_PATH' ) ) {
	define( 'WP_TESTS_PHPUNIT_POLYFILLS_PATH', dirname( __DIR__ ) . '/vendor/yoast/phpunit-polyfills' );
}

// Give tests access to the helper functions.
require_once "{$_tests_dir}/includes/functions.php";

tests_add_filter(
	'muplugins_loaded',
	static function () {
		// Activate the SEO plugin under test, so its install routines (custom
		// tables, role capabilities) run exactly as they would on a real site.
		// The activation hook itself fires after plugins_loaded, where the
		// pluggable functions such hooks may use exist.
		$seo_plugin = getenv( 'TINYSTUDIO_TEST_SEO_PLUGIN' );

		if ( ! $seo_plugin ) {
			require_once dirname( __DIR__ ) . '/tinystudio-connector.php';
			return;
		}

		require_once ABSPATH . 'wp-admin/includes/plugin.php';

		// Rank Math stops its own setup before the REST routes exist unless its
		// connectivity check is skipped, which this constant does.
		if ( ! defined( 'RANK_MATH_REGISTRATION_SKIP' ) ) {
			define( 'RANK_MATH_REGISTRATION_SKIP', true );
		}

		if ( ! is_plugin_active( $seo_plugin ) ) {
			$active   = (array) get_option( 'active_plugins', array() );
			$active[] = $seo_plugin;
			update_option( 'active_plugins', array_values( array_unique( $active ) ) );

			// The plugin file is required here directly: the list of plugins
			// to load was read before this hook ran, so this request would not
			// load the newly activated plugin on its own.
			require_once WP_PLUGIN_DIR . '/' . $seo_plugin;

			$GLOBALS['tinystudio_connector_activated'] = $seo_plugin;
		}

		require_once dirname( __DIR__ ) . '/tinystudio-connector.php';
	}
);

tests_add_filter(
	'plugins_loaded',
	static function () {
		$seo_plugin = getenv( 'TINYSTUDIO_TEST_SEO_PLUGIN' );

		if ( ! $seo_plugin || empty( $GLOBALS['tinystudio_connector_activated'] ) ) {
			return;
		}

		// The pluggable functions exist here, and the plugin under test has
		// loaded, so its activation hook can run as on a real site.
		do_action( 'activate_' . $seo_plugin, false );
	}
);

// Start up the WP testing environment.
require "{$_tests_dir}/includes/bootstrap.php";

// PHPUnit discovers test files alphabetically, so the shared test case is
// required here explicitly instead of relying on file order.
require_once __DIR__ . '/Tinystudio_Connector_TestCase.php';
