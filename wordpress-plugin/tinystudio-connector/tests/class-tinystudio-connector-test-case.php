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
	protected function set_up(): void {
		parent::set_up();
		unset( $_SERVER['HTTP_AUTHORIZATION'] );
		add_filter( 'wp_is_application_passwords_available', '__return_true' );
		add_filter( 'wp_is_application_passwords_available_for_user', '__return_true' );
	}

	/**
	 * Removes the test filters again.
	 *
	 * @return void
	 */
	protected function tear_down(): void {
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
		$this->assertSame( $slug, tinystudio_connector_active_seo_plugin() );
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
		$request                       = new WP_REST_Request( $method, $route );
		$request->set_body_params( $params );
		$response = rest_get_server()->dispatch( $request );
		unset( $_SERVER['HTTP_AUTHORIZATION'] );

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
		ob_start();
		do_action( 'wp_head' );

		return (string) ob_get_clean();
	}
}
