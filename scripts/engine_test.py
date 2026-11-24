import ctypes
import importlib.util
import json
import os
import tempfile
import unittest
from unittest import mock

HELPER = os.path.join(os.path.dirname(__file__), '..', 'src', 'lib', 'transcription', 'engine.py')
SPEC = importlib.util.spec_from_file_location('engine', HELPER)
engine = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(engine)

SECOND = engine.SAMPLE_RATE


class SpeakersTest(unittest.TestCase):
    def test_a_stretch_goes_to_the_voice_heard_most_in_it(self):
        turns = [(0, 2 * SECOND, '1'), (2 * SECOND, 5 * SECOND, '2')]
        self.assertEqual(engine.speaker_at(SECOND, 4 * SECOND, turns), '2')

    def test_a_stretch_no_turn_covers_goes_to_the_nearest(self):
        turns = [(0, SECOND, '1'), (10 * SECOND, 12 * SECOND, '2')]
        self.assertEqual(engine.speaker_at(8 * SECOND, 9 * SECOND, turns), '2')

    def test_without_turns_there_is_no_speaker(self):
        self.assertIsNone(engine.speaker_at(0, SECOND, []))


class SpansTest(unittest.TestCase):
    def test_close_stretches_of_one_voice_become_one(self):
        stretches = [(0, 2 * SECOND), (2 * SECOND + SECOND // 2, 4 * SECOND)]
        self.assertEqual(engine.spans_of(stretches, [], 30 * SECOND), [(0, 4 * SECOND, None)])

    def test_a_long_pause_keeps_stretches_apart(self):
        stretches = [(0, SECOND), (3 * SECOND, 4 * SECOND)]
        self.assertEqual(len(engine.spans_of(stretches, [], 30 * SECOND)), 2)

    def test_no_span_grows_past_the_longest_the_model_takes(self):
        stretches = [(0, 2 * SECOND), (2 * SECOND, 4 * SECOND)]
        self.assertEqual(len(engine.spans_of(stretches, [], 3 * SECOND)), 2)

    def test_a_stretch_is_cut_where_the_voice_changes(self):
        turns = [(0, 2 * SECOND, '1'), (2 * SECOND, 4 * SECOND, '2')]
        self.assertEqual(engine.spans_of([(0, 4 * SECOND)], turns, 30 * SECOND),
                         [(0, 2 * SECOND, '1'), (2 * SECOND, 4 * SECOND, '2')])


class WordsTest(unittest.TestCase):
    def test_timed_words_land_where_their_span_starts(self):
        words = engine.words_from([(' Hallo ', 500, 900)], 'Hallo', 10 * SECOND, 12 * SECOND, None, [])
        self.assertEqual(words, [{'end': 10.9, 'speaker': None, 'start': 10.5, 'text': 'Hallo'}])

    def test_each_timed_word_takes_the_voice_it_was_said_in(self):
        turns = [(0, SECOND, '1'), (SECOND, 2 * SECOND, '2')]
        words = engine.words_from([('Ja', 100, 400), ('Nein', 1200, 1500)], 'Ja Nein', 0,
                                  2 * SECOND, '1', turns)
        self.assertEqual([word['speaker'] for word in words], ['1', '2'])

    def test_an_untimed_answer_spans_the_whole_stretch(self):
        words = engine.words_from([], ' Guten Morgen. ', SECOND, 3 * SECOND, '1', [])
        self.assertEqual(words, [{'end': 3.0, 'speaker': '1', 'start': 1.0, 'text': 'Guten Morgen.'}])

    def test_silence_says_nothing(self):
        self.assertEqual(engine.words_from([], '  ', 0, SECOND, None, []), [])


class SettingsTest(unittest.TestCase):
    def test_kinds_follow_the_engine_field_types(self):
        self.assertEqual(engine.kind_of(ctypes.c_bool), 'switch')
        self.assertEqual(engine.kind_of(ctypes.c_float), 'number')
        self.assertEqual(engine.kind_of(ctypes.c_int32), 'integer')
        self.assertEqual(engine.kind_of(ctypes.c_char_p), 'text')
        self.assertIsNone(engine.kind_of(ctypes.POINTER(ctypes.c_int32)))

    def test_a_refusal_keeps_only_what_went_wrong(self):
        error = RuntimeError('transcribe_stream_begin: invalid argument (status 1)')
        self.assertEqual(engine.reason(error), 'invalid argument')


class DownloadTest(unittest.TestCase):
    def setUp(self):
        self.root = tempfile.TemporaryDirectory()
        self.addCleanup(self.root.cleanup)
        self.pins = {
            'files': [
                {'name': 'speech.gguf', 'purpose': 'speech', 'sha256': '', 'size': 4,
                 'url': 'https://huggingface.co/speech.gguf'},
                {'machine': 'x86_64', 'name': 'native.whl', 'purpose': 'engine', 'sha256': '',
                 'size': 8, 'url': 'https://files.pythonhosted.org/native.whl'},
            ],
            'version': '2.0.0',
        }
        patches = [
            mock.patch.object(engine, 'pins', lambda: self.pins),
            mock.patch.object(engine.platform, 'machine', lambda: 'x86_64'),
        ]
        for patch in patches:
            patch.start()
            self.addCleanup(patch.stop)

    def place(self, version, *files):
        directory = os.path.join(self.root.name, version)
        os.makedirs(os.path.join(directory, 'files'))
        for name, size in files:
            with open(os.path.join(directory, 'files', name), 'wb') as file:
                file.write(bytes(size))
        return directory

    def test_everything_is_downloaded_the_first_time(self):
        directory = os.path.join(self.root.name, '2.0.0')
        self.assertEqual(engine.plan({'engine': directory}),
                         {'bytes': 12, 'hosts': ['files.pythonhosted.org', 'huggingface.co']})

    def test_an_update_keeps_the_models_it_already_has(self):
        self.place('1.0.0', ('speech.gguf', 4))
        directory = os.path.join(self.root.name, '2.0.0')
        self.assertEqual(engine.plan({'engine': directory}),
                         {'bytes': 8, 'hosts': ['files.pythonhosted.org']})

    def test_a_file_of_the_wrong_size_is_downloaded_again(self):
        directory = self.place('2.0.0', ('speech.gguf', 3))
        self.assertEqual(engine.plan({'engine': directory})['bytes'], 12)

    def test_a_ready_engine_needs_nothing(self):
        directory = self.place('2.0.0')
        with open(os.path.join(directory, 'ready'), 'w') as marker:
            marker.write('2.0.0')
        self.assertEqual(engine.plan({'engine': directory}), {'bytes': 0, 'hosts': []})

    def test_a_computer_the_engine_is_not_made_for_is_told_so(self):
        with mock.patch.object(engine.platform, 'machine', lambda: 'riscv64'):
            with self.assertRaises(engine.Refusal):
                engine.plan({'engine': os.path.join(self.root.name, '2.0.0')})


class AnswerTest(unittest.TestCase):
    def test_an_unknown_command_answers_with_an_error(self):
        with mock.patch.object(engine.sys, 'argv', ['engine.py', 'sing']), \
                mock.patch('builtins.print') as printed:
            self.assertEqual(engine.main(), 1)
        self.assertEqual(json.loads(printed.call_args.args[0]), {'error': 'No command is named sing'})


if __name__ == '__main__':
    unittest.main()
