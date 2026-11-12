<?php
/**
 * All in One SEO tests: the connector registers nothing, and All in One SEO's
 * own REST write path works without it.
 *
 * @package tinystudio-connector
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Tests the connector against All in One SEO.
 */
final class Tinystudio_Connector_All_In_One_Seo_Test extends Tinystudio_Connector_TestCase {

	/**
	 * Fails early unless the suite runs against All in One SEO.
	 *
	 * @return void
	 */
	protected function set_up(): void {
		parent::set_up();
		$this->assert_detected_seo_plugin( 'all-in-one-seo' );
	}

	/**
	 * All in One SEO already accepts SEO writes through its aioseo_meta_data
	 * field on the core REST endpoints, so the connector registers nothing for
	 * it.
	 *
	 * @return void
	 */
	public function test_connector_registers_nothing_for_all_in_one_seo(): void {
		foreach ( tinystudio_connector_supported_post_types() as $post_type ) {
			$this->assertSame(
				array(),
				tinystudio_connector_registered_fields( $post_type ),
				"The connector must not register Yoast fields for {$post_type}."
			);
		}

		$args = get_registered_meta_keys( 'post', 'page' );
		$this->assertArrayNotHasKey( '_yoast_wpseo_canonical', $args );
		$this->assertArrayNotHasKey( '_yoast_wpseo_meta-robots-noindex', $args );
		$this->assertArrayNotHasKey( '_yoast_wpseo_metadesc', $args );
	}

	/**
	 * An Editor with an application password writes a page's description,
	 * preferred address and hide-from-search through All in One SEO's own REST
	 * field on the core endpoints, and the rendered head then shows the new
	 * values.
	 *
	 * @return void
	 */
	public function test_all_in_one_seo_writes_a_pages_seo_fields_through_the_core_rest_api(): void {
		list( , $authorization ) = $this->editor_with_application_password();
		$page_id = self::factory()->post->create( array( 'post_type' => 'page', 'post_status' => 'publish' ) );

		$response = $this->authenticated_rest_request(
			'PUT',
			'/wp/v2/pages/' . $page_id,
			array(
				'aioseo_meta_data' => array(
					'title'         => 'TinyStudio repaired this page title',
					'description'   => 'TinyStudio repaired this page description.',
					'canonical_url' => 'https://tinystudio.example/repaired-page',
					'robots'        => array(
						'default' => false,
						'noindex' => true,
					),
				),
			),
			$authorization
		);

		$this->assertSame( 200, $response->get_status() );

		$head = $this->rendered_head( get_permalink( $page_id ) );
		$this->assertStringContainsString( 'TinyStudio repaired this page title', $head );
		$this->assertStringContainsString( 'TinyStudio repaired this page description.', $head );
		$this->assertStringContainsString( 'https://tinystudio.example/repaired-page', $head );
		$this->assertStringContainsString( 'noindex', $head );
	}

	/**
	 * A Subscriber with an application password is refused by All in One SEO's
	 * own update callback.
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
				'aioseo_meta_data' => array(
					'description' => 'TinyStudio repaired this page description.',
				),
			),
			$authorization
		);

		$this->assertGreaterThanOrEqual( 400, $response->get_status() );

		$head = $this->rendered_head( get_permalink( $page_id ) );
		$this->assertStringNotContainsString( 'TinyStudio repaired this page description.', $head );
	}
}
