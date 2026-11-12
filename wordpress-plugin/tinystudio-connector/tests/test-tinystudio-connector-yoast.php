<?php
/**
 * REST write tests for the Yoast SEO fields the connector registers.
 *
 * @package tinystudio-connector
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Tests the connector against Yoast SEO.
 */
final class Tinystudio_Connector_Yoast_Test extends Tinystudio_Connector_TestCase {

	/**
	 * Fails early unless the suite runs against Yoast SEO.
	 *
	 * @return void
	 */
	protected function set_up(): void {
		parent::set_up();
		$this->assert_detected_seo_plugin( 'yoast' );
	}

	/**
	 * An Editor with an application password writes a page's search
	 * description, preferred address and hide-from-search through the core
	 * REST API, and the rendered head then shows the new values.
	 *
	 * @return void
	 */
	public function test_editor_writes_a_pages_seo_fields_through_the_core_rest_api(): void {
		list( , $authorization ) = $this->editor_with_application_password();
		$page_id = self::factory()->post->create( array( 'post_type' => 'page', 'post_status' => 'publish' ) );

		$response = $this->authenticated_rest_request(
			'PUT',
			'/wp/v2/pages/' . $page_id,
			array(
				'meta' => array(
					'_yoast_wpseo_metadesc'            => 'TinyStudio repaired this page description.',
					'_yoast_wpseo_canonical'           => 'https://tinystudio.example/repaired-page',
					'_yoast_wpseo_meta-robots-noindex' => '1',
				),
			),
			$authorization
		);

		$this->assertSame( 200, $response->get_status() );
		$this->assertSame( 'TinyStudio repaired this page description.', get_post_meta( $page_id, '_yoast_wpseo_metadesc', true ) );
		$this->assertSame( 'https://tinystudio.example/repaired-page', get_post_meta( $page_id, '_yoast_wpseo_canonical', true ) );
		$this->assertSame( '1', get_post_meta( $page_id, '_yoast_wpseo_meta-robots-noindex', true ) );

		$head = $this->rendered_head( get_permalink( $page_id ) );
		$this->assertStringContainsString( 'TinyStudio repaired this page description.', $head );
		$this->assertStringContainsString( 'https://tinystudio.example/repaired-page', $head );
		$this->assertStringContainsString( 'noindex', $head );
	}

	/**
	 * A Subscriber with an application password is refused.
	 *
	 * @return void
	 */
	public function test_subscriber_is_refused(): void {
		list( , $authorization ) = $this->subscriber_with_application_password();
		$page_id = self::factory()->post->create( array( 'post_type' => 'page', 'post_status' => 'publish' ) );

		$response = $this->authenticated_rest_request(
			'PUT',
			'/wp/v2/pages/' . $page_id,
			array(
				'meta' => array(
					'_yoast_wpseo_canonical' => 'https://tinystudio.example/repaired-page',
				),
			),
			$authorization
		);

		$this->assertSame( 403, $response->get_status() );
		$this->assertSame( '', get_post_meta( $page_id, '_yoast_wpseo_canonical', true ) );
	}

	/**
	 * A script tag in a description is stripped before it is stored.
	 *
	 * @return void
	 */
	public function test_script_tag_in_a_description_is_stripped(): void {
		list( , $authorization ) = $this->editor_with_application_password();
		$page_id = self::factory()->post->create( array( 'post_type' => 'page', 'post_status' => 'publish' ) );

		$response = $this->authenticated_rest_request(
			'PUT',
			'/wp/v2/pages/' . $page_id,
			array(
				'meta' => array(
					'_yoast_wpseo_metadesc' => '<script>alert("pwned")</script>TinyStudio repaired this page.',
				),
			),
			$authorization
		);

		$this->assertSame( 200, $response->get_status() );
		$this->assertSame( 'alert("pwned")TinyStudio repaired this page.', get_post_meta( $page_id, '_yoast_wpseo_metadesc', true ) );

		$head = $this->rendered_head( get_permalink( $page_id ) );
		$this->assertStringNotContainsString( '<script', $head );
		$this->assertStringContainsString( 'TinyStudio repaired this page.', $head );
	}

	/**
	 * A non-URL preferred address is rejected.
	 *
	 * @return void
	 */
	public function test_non_url_canonical_is_rejected(): void {
		list( , $authorization ) = $this->editor_with_application_password();
		$page_id = self::factory()->post->create( array( 'post_type' => 'page', 'post_status' => 'publish' ) );

		$response = $this->authenticated_rest_request(
			'PUT',
			'/wp/v2/pages/' . $page_id,
			array(
				'meta' => array(
					'_yoast_wpseo_canonical' => 'not a url',
				),
			),
			$authorization
		);

		$this->assertSame( 400, $response->get_status() );
		$this->assertSame( '', get_post_meta( $page_id, '_yoast_wpseo_canonical', true ) );
	}

	/**
	 * An unknown hide-from-search value is rejected.
	 *
	 * @return void
	 */
	public function test_unknown_noindex_value_is_rejected(): void {
		list( , $authorization ) = $this->editor_with_application_password();
		$page_id = self::factory()->post->create( array( 'post_type' => 'page', 'post_status' => 'publish' ) );

		$response = $this->authenticated_rest_request(
			'PUT',
			'/wp/v2/pages/' . $page_id,
			array(
				'meta' => array(
					'_yoast_wpseo_meta-robots-noindex' => '7',
				),
			),
			$authorization
		);

		$this->assertSame( 400, $response->get_status() );
		$this->assertSame( '', get_post_meta( $page_id, '_yoast_wpseo_meta-robots-noindex', true ) );
	}

	/**
	 * An unknown meta key is ignored.
	 *
	 * @return void
	 */
	public function test_unknown_meta_key_is_ignored(): void {
		list( , $authorization ) = $this->editor_with_application_password();
		$page_id = self::factory()->post->create( array( 'post_type' => 'page', 'post_status' => 'publish' ) );

		$response = $this->authenticated_rest_request(
			'PUT',
			'/wp/v2/pages/' . $page_id,
			array(
				'meta' => array(
					'tinystudio_connector_unknown_key' => 'ignored',
				),
			),
			$authorization
		);

		$this->assertSame( 200, $response->get_status() );
		$this->assertSame( '', get_post_meta( $page_id, 'tinystudio_connector_unknown_key', true ) );
	}

	/**
	 * The connector covers only the gap: on the post post type, where Yoast
	 * itself already registers the search description for REST writes, the
	 * connector registers nothing, so Yoast's own sanitize and auth callbacks
	 * stay in place.
	 *
	 * @return void
	 */
	public function test_connector_leaves_yoasts_own_description_registration_for_posts_alone(): void {
		$registered = tinystudio_connector_registered_fields( 'post' );

		$this->assertNotContains( '_yoast_wpseo_metadesc', $registered );
		$this->assertContains( '_yoast_wpseo_canonical', $registered );
		$this->assertContains( '_yoast_wpseo_meta-robots-noindex', $registered );

		// Yoast's own registration is still the one on record: its auth
		// callback is its own closure, not the connector's named function.
		$args = get_registered_meta_keys( 'post', 'post' );
		$this->assertArrayHasKey( '_yoast_wpseo_metadesc', $args );
		$this->assertNotFalse( $args['_yoast_wpseo_metadesc']['show_in_rest'] );
		$this->assertInstanceOf( 'Closure', $args['_yoast_wpseo_metadesc']['auth_callback'] );
	}

	/**
	 * The description write on the post post type works through Yoast's own
	 * REST registration, without any help from the connector.
	 *
	 * @return void
	 */
	public function test_yoast_writes_the_description_for_posts_through_its_own_registration(): void {
		list( , $authorization ) = $this->editor_with_application_password();
		$post_id = self::factory()->post->create( array( 'post_status' => 'publish' ) );

		$response = $this->authenticated_rest_request(
			'PUT',
			'/wp/v2/posts/' . $post_id,
			array(
				'meta' => array(
					'_yoast_wpseo_metadesc' => 'Yoast wrote this post description itself.',
				),
			),
			$authorization
		);

		$this->assertSame( 200, $response->get_status() );
		$this->assertSame( 'Yoast wrote this post description itself.', get_post_meta( $post_id, '_yoast_wpseo_metadesc', true ) );

		$head = $this->rendered_head( get_permalink( $post_id ) );
		$this->assertStringContainsString( 'Yoast wrote this post description itself.', $head );
	}
}
