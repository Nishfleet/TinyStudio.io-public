<?php
/**
 * Shared test case: application-password REST writes and rendered head checks.
 *
 * @package tinystudio-connector
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Base test case with the plumbing every SEO-plugin test suite shares.
 */
abstract class Tinystudio_Connector_TestCase extends WP_UnitTestCase {

	/**
	 * Makes application passwords usable in the test environment.
	 *
	 * @return void
	 */
	public function set_up(): void {
		parent::set_up();
		unset( $_SERVER['HTTP_AUTHORIZATION'] );
		add_filter( 'wp_is_application_passwords_available', '__return_true' );
		add_filter( 'wp_is_application_passwords_available_for_user', '__return_true' );

		// The WP test suite unregisters every meta key after each test, while
		// both the SEO plugin under test and the connector register their REST
		// meta only once per request. Re-run those registrations here so every
		// test starts from the state a real site has.
		if ( 'yoast' === tinystudio_connector_active_seo_plugin() ) {
			WPSEO_Meta::init();

			// The rendered head must show the description without a script
			// tag, and Yoast's own JSON-LD schema would add one regardless
			// of the written meta, so its output is switched off here.
			add_filter( 'wpseo_json_ld_output', '__return_false' );
		}
		tinystudio_connector_register_seo_fields();
	}

	/**
	 * Removes the test filters again.
	 *
	 * @return void
	 */
	public function tear_down(): void {
		remove_filter( 'wp_is_application_passwords_available', '__return_true' );
		remove_filter( 'wp_is_application_passwords_available_for_user', '__return_true' );
		unset( $_SERVER['HTTP_AUTHORIZATION'] );
		parent::tear_down();
	}

	/**
	 * Asserts the suite is running against the expected SEO plugin, so a
	 * wrongly deactivated plugin can never fake a pass.
	 *
	 * @param string $slug Expected slug.
	 * @return void
	 */
	protected function assert_detected_seo_plugin( $slug ): void {
		$active = tinystudio_connector_active_seo_plugin();

		// Every suite's directory scan runs all three test classes, so when
		// another SEO plugin is the one under test these tests skip. When no
		// SEO plugin is detected at all the check below still fails, so a
		// wrongly deactivated plugin can never fake a pass.
		if ( $active && $slug !== $active ) {
			$this->markTestSkipped( "This suite runs against {$slug}, but {$active} is active." );
		}

		$this->assertSame( $slug, $active );
	}

	/**
	 * Creates an editor user with an application password.
	 *
	 * @return array{0:int,1:string} The user ID and the Basic authorization header.
	 */
	protected function editor_with_application_password(): array {
		$user_id = self::factory()->user->create( array( 'role' => 'editor' ) );

		return array( $user_id, $this->application_password_for( $user_id ) );
	}

	/**
	 * Creates a subscriber user with an application password.
	 *
	 * @return array{0:int,1:string} The user ID and the Basic authorization header.
	 */
	protected function subscriber_with_application_password(): array {
		$user_id = self::factory()->user->create( array( 'role' => 'subscriber' ) );

		return array( $user_id, $this->application_password_for( $user_id ) );
	}

	/**
	 * Creates an application password and returns the Basic header for it.
	 *
	 * @param int $user_id User ID.
	 * @return string The Basic authorization header.
	 */
	protected function application_password_for( $user_id ): string {
		$passwords = WP_Application_Passwords::create_new_application_password(
			$user_id,
			array( 'name' => 'tinystudio-connector-tests' )
		);

		// base64_encode is the standard way to build an HTTP Basic header, not obfuscation.
		// phpcs:ignore WordPress.PHP.DiscouragedPHPFunctions.obfuscation_base64_encode
		return 'Basic ' . base64_encode( get_userdata( $user_id )->user_login . ':' . $passwords[0] );
	}

	/**
	 * Dispatches an authenticated REST request through WordPress's own REST server.
	 *
	 * @param string $method        HTTP method.
	 * @param string $route         REST route, e.g. /wp/v2/pages/1.
	 * @param array  $params        Body parameters.
	 * @param string $authorization Basic authorization header.
	 * @return WP_REST_Response The response.
	 */
	protected function authenticated_rest_request( $method, $route, array $params, $authorization ): WP_REST_Response {
		$_SERVER['HTTP_AUTHORIZATION'] = $authorization;

		// WordPress's application password authenticator reads the Basic
		// credentials from PHP_AUTH_USER / PHP_AUTH_PW, so they are provided
		// here as well.
		list( , $userpass ) = explode( ' ', $authorization, 2 );
		// phpcs:ignore WordPress.PHP.DiscouragedPHPFunctions.obfuscation_base64_decode -- decodes the request's own test credentials.
		list( $user_name, $user_pass ) = explode( ':', base64_decode( $userpass ), 2 );
		$_SERVER['PHP_AUTH_USER']      = $user_name;
		$_SERVER['PHP_AUTH_PW']        = $user_pass;

		// A dispatched request runs inside this PHPUnit process, so two
		// nudges are needed that a real HTTP request would not need (these
		// are the same ones WordPress's own application password tests use):
		// REST_REQUEST is not defined outside serve_request(), and the
		// current user global already holds the anonymous user, which stops
		// the determine_current_user chain from ever consulting the Basic
		// credentials.
		add_filter( 'application_password_is_api_request', '__return_true' );
		$GLOBALS['current_user'] = null;

		$request = new WP_REST_Request( $method, $route );
		$request->set_body_params( $params );
		$response = rest_get_server()->dispatch( $request );

		remove_filter( 'application_password_is_api_request', '__return_true' );
		unset( $_SERVER['HTTP_AUTHORIZATION'], $_SERVER['PHP_AUTH_USER'], $_SERVER['PHP_AUTH_PW'] );

		return $response;
	}

	/**
	 * Renders the head of a permalink through the wp_head action.
	 *
	 * This is the proof the repair reaches a visitor: the value written over
	 * REST shows up in the rendered head the SEO plugin produces.
	 *
	 * @param string $permalink The permalink to render.
	 * @return string The rendered head.
	 */
	protected function rendered_head( $permalink ): string {
		$this->go_to( $permalink );

		// Yoast memoizes its front-end context for the current page. A test run
		// is one long-lived process, so the memo is cleared here to render this
		// permalink's own head instead of a previous test's.
		if ( 'yoast' === tinystudio_connector_active_seo_plugin() ) {
			YoastSEO()->classes->get( \Yoast\WP\SEO\Memoizers\Meta_Tags_Context_Memoizer::class )->clear();
		}

		ob_start();
		do_action( 'wp_head' );

		return (string) ob_get_clean();
	}
}
