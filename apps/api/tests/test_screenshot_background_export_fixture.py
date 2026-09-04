from types import SimpleNamespace

from scripts import screenshot_background_export_fixture as fixture


def test_purge_export_queue_uses_only_export_queue(monkeypatch):
    channel = object()

    class FakeQueue:
        def bind(self, received_channel):
            assert received_channel is channel
            return self

        def purge(self):
            return 2

    class FakeConnection:
        default_channel = channel

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

    fake_app = SimpleNamespace(
        connection_for_write=lambda: FakeConnection(),
        amqp=SimpleNamespace(queues={"export": FakeQueue()}),
    )
    monkeypatch.setattr(fixture, "celery_app", fake_app)

    assert fixture._purge_export_queue() == 2
